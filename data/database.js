const { MongoClient } = require('mongodb');

// One MongoClient is created for the whole process and reused by every request.
// The driver keeps an internal connection pool, so opening a new client per
// request would be slow and would eventually exhaust the server's connections.
let client;
let database;
// The in-flight connection attempt. Caching the *promise* (not just the result)
// is what makes initDb safe to call from two places at once — see below.
let connecting;

// Atlas hands out a URI with <db_username>/<db_password> placeholders in it.
// If MONGODB_USERNAME and MONGODB_PASSWORD are set, splice them in here rather
// than making someone hand-edit the URI. encodeURIComponent escapes characters
// like @ : / ? # that would otherwise break the URI's structure.
const buildUri = () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set. Copy .env.example to .env and fill it in.');
  }

  const username = process.env.MONGODB_USERNAME;
  const password = process.env.MONGODB_PASSWORD;
  if (!username || !password) return uri; // credentials already inside the URI

  const credentials = `${encodeURIComponent(username)}:${encodeURIComponent(password)}`;
  // Replace whatever sits between "//" and "@" — placeholders or real values.
  return uri.replace(/^(mongodb(?:\+srv)?:\/\/)(?:[^@/]*@)?/, `$1${credentials}@`);
};

// Deliberately NOT `async`. An async function would have to `await` the connect
// call, and everything after an `await` runs later — long enough for a second
// caller to slip past the `if (database)` check and open a second MongoClient.
// Here the check and the assignment to `connecting` happen in one uninterrupted
// step, so concurrent callers all receive the same promise and the same client.
const initDb = () => {
  if (database) return Promise.resolve(database);

  if (!connecting) {
    const pending = new MongoClient(buildUri());

    connecting = pending
      .connect()
      .then(() => {
        client = pending;
        // 'boardgames' is a NEW database, deliberately not the 'cse341' one the
        // contacts project used. The assignment asks for a separate database.
        database = pending.db(process.env.MONGODB_DB_NAME || 'boardgames');
        return database;
      })
      .catch((err) => {
        // Clear the cache so a later call can retry instead of being handed
        // this same rejected promise forever.
        connecting = undefined;
        throw err;
      });
  }

  return connecting;
};

const getDatabase = () => {
  if (!database) {
    throw new Error('Database not initialized. Call initDb() before getDatabase().');
  }
  return database;
};

// Shorthands so controllers do not repeat the collection name as a string
// literal in five places. A typo in one of those would silently create a new
// empty collection instead of failing, which is a miserable bug to find.
const games = () => getDatabase().collection('games');
const sessions = () => getDatabase().collection('sessions');
const users = () => getDatabase().collection('users');

const closeDb = async () => {
  // Take a local copy and clear the module state *before* awaiting, so nothing
  // can observe a half-closed database while close() is still running.
  const openClient = client;
  client = undefined;
  database = undefined;
  connecting = undefined;

  if (openClient) await openClient.close();
};

module.exports = { initDb, getDatabase, closeDb, games, sessions, users };
