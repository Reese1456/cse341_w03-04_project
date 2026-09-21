const { ObjectId } = require('mongodb');

const { games, sessions } = require('../data/database');
const { createValidator, isValidObjectId, isPlainObject } = require('../utils/validation');

/**
 * Checks a request body and returns { errors, document }.
 *
 * Note what this does NOT do: confirm the game actually exists. That needs a
 * database round trip, so it stays in the controller — see `findMissingGame`.
 */
const validateSession = (body) => {
  if (!isPlainObject(body)) {
    return { errors: ['Request body must be a JSON object.'], document: {} };
  }

  const v = createValidator(body);

  v.objectId('gameId');
  // A session records a game that was already played, so a future date is a
  // typo rather than a plan.
  v.isoDate('playedOn', { notFuture: true });
  v.stringArray('players', { minItems: 1, max: 50 });
  v.string('winner');
  v.int('durationMinutes', { min: 1, max: 10000 });
  v.optionalString('notes', { max: 500 });

  const { errors, document } = v.result();

  // The other cross-field rule. Both fields have to have survived their own
  // checks first, or this would compare against undefined and produce a second,
  // confusing error on top of the real one.
  if (document.winner !== undefined && document.players !== undefined) {
    v.check(
      document.players.includes(document.winner),
      `"winner" must be one of the players: ${document.players.join(', ')}.`,
    );
  }

  return { errors, document };
};

/**
 * Returns an error message when `gameId` refers to no game, or null when it is
 * fine. A dangling reference is a 400, not a 404: the /sessions URL itself
 * exists, and what is wrong is a value inside the body — which is exactly what
 * "the data requirements were not met" means.
 */
const findMissingGame = async (gameId) => {
  // projection: {_id: 1} asks Mongo to send back only the id. We just need to
  // know whether a document is there, so there is no reason to transfer nine
  // fields across the network to find out.
  const game = await games().findOne({ _id: gameId }, { projection: { _id: 1 } });

  return game ? null : `No game exists with id ${gameId.toString()}.`;
};

const getAllSessions = async (req, res) => {
  // #swagger.tags = ['Sessions']
  // #swagger.summary = 'Get every play session, newest first'
  // #swagger.description = 'Pass ?gameId= to return only the sessions for one game. This is how the two collections relate: a session stores the _id of the game it belongs to.'
  /* #swagger.responses[200] = {
       description: 'An array of sessions (empty if there are none)',
       content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/SessionWithId' } } } }
  } */
  /* #swagger.responses[400] = {
       description: 'The gameId query parameter is not a valid ObjectId',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  } */
  /* #swagger.responses[500] = {
       description: 'The database could not be reached',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  } */
  // This one comes LAST on purpose, and on a single line. swagger-autogen v2
  // parses annotations by brace matching rather than with a real JS parser, and
  // a query parameter (unlike a path parameter, which it already knows from the
  // route) makes it keep reading into whatever #swagger blocks follow — emitting
  // their "description" and "content" keys as phantom query parameters. With
  // nothing after it, there is nothing left to misread. It also wants `type`
  // directly here, not a nested `schema: { ... }`.
  // prettier-ignore
  // #swagger.parameters['gameId'] = { in: 'query', required: false, type: 'string', description: 'Optional filter: only sessions for this game', example: '000000000000000000000000' }
  const { gameId } = req.query;

  // An absent filter is fine; a present but malformed one is a mistake worth
  // reporting, rather than silently returning every session.
  const filter = {};
  if (gameId !== undefined) {
    if (!isValidObjectId(gameId)) {
      return res.status(400).json({ message: 'Invalid gameId query parameter.' });
    }
    filter.gameId = new ObjectId(gameId);
  }

  try {
    const allSessions = await sessions().find(filter).sort({ playedOn: -1 }).toArray();

    res.status(200).json(allSessions);
  } catch (err) {
    console.error('GET /sessions failed:', err);
    res.status(500).json({ message: 'Failed to load sessions.' });
  }
};

const getSingleSession = async (req, res) => {
  // #swagger.tags = ['Sessions']
  // #swagger.summary = 'Get one play session by its MongoDB ObjectId'
  /* #swagger.parameters['id'] = {
       description: 'The session\'s MongoDB ObjectId (24 hex characters)',
       example: '000000000000000000000000'
  } */
  /* #swagger.responses[200] = {
       description: 'The matching session',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/SessionWithId' } } }
  } */
  /* #swagger.responses[400] = {
       description: 'The id is not a valid ObjectId',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  } */
  /* #swagger.responses[404] = {
       description: 'No session has that id',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  } */
  /* #swagger.responses[500] = {
       description: 'The database could not be reached',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  } */
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid session ID.' });
  }

  try {
    const session = await sessions().findOne({ _id: new ObjectId(id) });

    if (!session) {
      return res.status(404).json({ message: 'Session not found.' });
    }

    res.status(200).json(session);
  } catch (err) {
    console.error(`GET /sessions/${id} failed:`, err);
    res.status(500).json({ message: 'Failed to load the session.' });
  }
};

const createSession = async (req, res) => {
  // #swagger.tags = ['Sessions']
  // #swagger.summary = 'Record a new play session'
  // #swagger.description = 'gameId must be the _id of a game that already exists, playedOn cannot be in the future, and winner must be one of the names in players. notes is the only optional field.'
  /* #swagger.requestBody = {
       required: true,
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Session' } } }
  } */
  /* #swagger.responses[201] = {
       description: 'Session created. The body includes the new id, and the Location header points to it.',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/CreatedSession' } } }
  } */
  /* #swagger.responses[400] = {
       description: 'A field is missing or badly formatted, or gameId refers to no existing game. errors lists every problem found.',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  } */
  /* #swagger.responses[500] = {
       description: 'The database could not be reached',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  } */
  const { errors, document } = validateSession(req.body);

  if (errors.length > 0) {
    return res.status(400).json({ message: 'Invalid session.', errors });
  }

  try {
    // Only worth asking the database once the id is known to be well-formed,
    // which is why this sits after the validation check rather than inside it.
    const missing = await findMissingGame(document.gameId);
    if (missing) {
      return res.status(400).json({ message: 'Invalid session.', errors: [missing] });
    }

    // Copy first: insertOne MUTATES the object it is given, adding an `_id`.
    const created = { ...document };
    const result = await sessions().insertOne(document);

    res
      .status(201)
      .location(`/sessions/${result.insertedId}`)
      .json({ id: result.insertedId, ...created });
  } catch (err) {
    console.error('POST /sessions failed:', err);
    res.status(500).json({ message: 'Failed to create the session.' });
  }
};

const updateSession = async (req, res) => {
  // #swagger.tags = ['Sessions']
  // #swagger.summary = 'Replace an existing play session'
  // #swagger.description = 'Replaces the whole session, so send every required field. The same validation rules as POST apply, including the check that gameId refers to a real game.'
  /* #swagger.parameters['id'] = {
       description: 'The session\'s MongoDB ObjectId (24 hex characters)',
       example: '000000000000000000000000'
  } */
  /* #swagger.requestBody = {
       required: true,
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Session' } } }
  } */
  // #swagger.responses[204] = { description: 'Session updated. There is no response body.' }
  /* #swagger.responses[400] = {
       description: 'The id is not a valid ObjectId, a field is missing or badly formatted, or gameId refers to no existing game',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  } */
  /* #swagger.responses[404] = {
       description: 'No session has that id',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  } */
  /* #swagger.responses[500] = {
       description: 'The database could not be reached',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  } */
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid session ID.' });
  }

  const { errors, document } = validateSession(req.body);

  if (errors.length > 0) {
    return res.status(400).json({ message: 'Invalid session.', errors });
  }

  try {
    const missing = await findMissingGame(document.gameId);
    if (missing) {
      return res.status(400).json({ message: 'Invalid session.', errors: [missing] });
    }

    // replaceOne, not updateOne with $set: PUT means "make the resource look
    // exactly like this", so `notes` disappearing from the body should remove it.
    const result = await sessions().replaceOne({ _id: new ObjectId(id) }, document);

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Session not found.' });
    }

    res.status(204).send();
  } catch (err) {
    console.error(`PUT /sessions/${id} failed:`, err);
    res.status(500).json({ message: 'Failed to update the session.' });
  }
};

const deleteSession = async (req, res) => {
  // #swagger.tags = ['Sessions']
  // #swagger.summary = 'Delete a play session'
  // #swagger.description = 'Deletes only this session. The game it referenced is left alone.'
  /* #swagger.parameters['id'] = {
       description: 'The session\'s MongoDB ObjectId (24 hex characters)',
       example: '000000000000000000000000'
  } */
  // #swagger.responses[204] = { description: 'Session deleted. There is no response body.' }
  /* #swagger.responses[400] = {
       description: 'The id is not a valid ObjectId',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  } */
  /* #swagger.responses[404] = {
       description: 'No session has that id',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  } */
  /* #swagger.responses[500] = {
       description: 'The database could not be reached',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  } */
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid session ID.' });
  }

  try {
    const result = await sessions().deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Session not found.' });
    }

    res.status(204).send();
  } catch (err) {
    console.error(`DELETE /sessions/${id} failed:`, err);
    res.status(500).json({ message: 'Failed to delete the session.' });
  }
};

module.exports = {
  getAllSessions,
  getSingleSession,
  createSession,
  updateSession,
  deleteSession,
  // See the note in controllers/games.js — data/seed.js validates its fixtures.
  validateSession,
};
