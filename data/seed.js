/**
 * One-off loader: pushes the local sample data into MongoDB.
 *
 *   npm run seed              add or update the sample data, leave anything else
 *   npm run seed -- --fresh   empty both collections first
 *
 * Use `--fresh` before recording: it guarantees the database looks exactly the
 * same at the start of every take, so you are never explaining a stray document
 * from an earlier attempt.
 *
 * Without it the script is still safe to re-run. Every write is an *upsert*
 * keyed on something stable, so running it twice updates the same documents
 * rather than inserting a second copy of everything.
 */
require('dotenv').config();

const { initDb, closeDb, games, sessions } = require('./database');
const { validateGame } = require('../controllers/games');
const { validateSession } = require('../controllers/sessions');
const gamesData = require('./games.json');
const sessionsData = require('./sessions.json');

const fresh = process.argv.includes('--fresh');

/**
 * Runs a fixture through the API's own validator.
 *
 * A seed script talks straight to MongoDB, which has no idea what our rules
 * are — so without this, a typo in games.json would load happily and then only
 * surface later as a confusing 400 when something tried to PUT it back. Failing
 * here instead points at the exact file, index, and field.
 */
const validateAll = (label, fixtures, validate) =>
  fixtures.map((fixture, index) => {
    const { errors, document } = validate(fixture);

    if (errors.length > 0) {
      throw new Error(
        `${label}[${index}] is not valid:\n  - ${errors.join('\n  - ')}\n` +
          `  fixture: ${JSON.stringify(fixture)}`,
      );
    }

    return document;
  });

const seed = async () => {
  await initDb();

  if (fresh) {
    const [removedSessions, removedGames] = await Promise.all([
      sessions().deleteMany({}),
      games().deleteMany({}),
    ]);
    console.log(
      `--fresh: removed ${removedGames.deletedCount} game(s) and ` +
        `${removedSessions.deletedCount} session(s).`,
    );
  }

  // ---- games ---------------------------------------------------------------

  const gameDocuments = validateAll('games.json', gamesData, validateGame);

  const gameResult = await games().bulkWrite(
    gameDocuments.map((game) => ({
      replaceOne: {
        // Title is the natural key here: it is what a person would use to say
        // "this is the same game", and it is what sessions.json refers to.
        filter: { title: game.title },
        replacement: game,
        upsert: true,
      },
    })),
  );

  console.log(
    `games: ${gameDocuments.length} loaded ` +
      `(${gameResult.upsertedCount} inserted, ${gameResult.modifiedCount} updated).`,
  );

  // ---- sessions ------------------------------------------------------------

  // sessions.json stores a gameTitle rather than a gameId, because the ObjectIds
  // do not exist until the games above have been inserted. Read them back and
  // build a lookup so each session can be pointed at the right game.
  const storedGames = await games()
    .find({}, { projection: { title: 1 } })
    .toArray();
  const idByTitle = new Map(storedGames.map((game) => [game.title, game._id]));

  const sessionDocuments = validateAll(
    'sessions.json',
    sessionsData.map(({ gameTitle, ...rest }, index) => {
      const gameId = idByTitle.get(gameTitle);

      if (!gameId) {
        throw new Error(
          `sessions.json[${index}] refers to gameTitle "${gameTitle}", which is ` +
            `not in games.json. Check the spelling.`,
        );
      }

      // The validator expects the 24-character string form, the same as an HTTP
      // request would carry, and converts it to a real ObjectId itself.
      return { ...rest, gameId: gameId.toString() };
    }),
    validateSession,
  );

  const sessionResult = await sessions().bulkWrite(
    sessionDocuments.map((session) => ({
      replaceOne: {
        // No single field identifies a session, so the key is the pair: one game
        // was played once on a given day.
        filter: { gameId: session.gameId, playedOn: session.playedOn },
        replacement: session,
        upsert: true,
      },
    })),
  );

  console.log(
    `sessions: ${sessionDocuments.length} loaded ` +
      `(${sessionResult.upsertedCount} inserted, ${sessionResult.modifiedCount} updated).`,
  );

  await closeDb();
};

seed().catch(async (err) => {
  console.error('Seed failed:', err.message);
  // Close the client even on failure, or the process hangs with an open socket
  // instead of exiting.
  await closeDb().catch(() => {});
  process.exit(1);
});
