const { ObjectId } = require('mongodb');

const { games, sessions } = require('../data/database');
const { createValidator, isValidObjectId, isPlainObject } = require('../utils/validation');

// The only values `complexity` may take. Keeping them in a named constant means
// the validator and the Swagger schema cannot drift apart.
const COMPLEXITY_LEVELS = ['light', 'medium', 'heavy'];

/**
 * Checks a request body and returns { errors, document }.
 *
 * `errors` is a list of human-readable problems; when it is empty, `document`
 * holds exactly the nine allowed fields, cleaned and ready to store. Both POST
 * and PUT use this, which is why PUT gets the same validation as POST for free.
 */
const validateGame = (body) => {
  if (!isPlainObject(body)) {
    return { errors: ['Request body must be a JSON object.'], document: {} };
  }

  const v = createValidator(body);

  v.string('title');
  v.string('publisher');
  // Upper bound is next year, not this year: publishers announce and list games
  // ahead of release, so a 2027 title is legitimate in 2026.
  v.int('yearPublished', { min: 1900, max: new Date().getFullYear() + 1 });
  v.int('minPlayers', { min: 1, max: 999 });
  v.int('maxPlayers', { min: 1, max: 999 });
  v.int('playTimeMinutes', { min: 1, max: 10000 });
  v.enumOf('complexity', COMPLEXITY_LEVELS);
  v.stringArray('categories', { minItems: 1 });
  v.email('ownerEmail');

  const { errors, document } = v.result();

  // A cross-field rule, so it runs only once both fields survived their own
  // checks — otherwise a request missing minPlayers would produce a confusing
  // second error about a comparison against undefined.
  if (document.minPlayers !== undefined && document.maxPlayers !== undefined) {
    v.check(
      document.maxPlayers >= document.minPlayers,
      '"maxPlayers" must be greater than or equal to "minPlayers".',
    );
  }

  return { errors, document };
};

const getAllGames = async (req, res) => {
  // #swagger.tags = ['Games']
  // #swagger.summary = 'Get every game'
  // #swagger.description = 'Returns every game in the collection, each with its MongoDB _id, sorted by title.'
  /* #swagger.responses[200] = {
       description: 'An array of games (empty if there are none)',
       content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/GameWithId' } } } }
  } */
  /* #swagger.responses[500] = {
       description: 'The database could not be reached',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  } */
  try {
    const allGames = await games().find({}).sort({ title: 1 }).toArray();

    res.status(200).json(allGames);
  } catch (err) {
    console.error('GET /games failed:', err);
    res.status(500).json({ message: 'Failed to load games.' });
  }
};

const getSingleGame = async (req, res) => {
  // #swagger.tags = ['Games']
  // #swagger.summary = 'Get one game by its MongoDB ObjectId'
  /* #swagger.parameters['id'] = {
       description: 'The game\'s MongoDB ObjectId (24 hex characters)',
       example: '000000000000000000000000'
  } */
  /* #swagger.responses[200] = {
       description: 'The matching game',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/GameWithId' } } }
  } */
  /* #swagger.responses[400] = {
       description: 'The id is not a valid ObjectId',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  } */
  /* #swagger.responses[404] = {
       description: 'No game has that id',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  } */
  /* #swagger.responses[500] = {
       description: 'The database could not be reached',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  } */
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid game ID.' });
  }

  try {
    const game = await games().findOne({ _id: new ObjectId(id) });

    if (!game) {
      return res.status(404).json({ message: 'Game not found.' });
    }

    res.status(200).json(game);
  } catch (err) {
    console.error(`GET /games/${id} failed:`, err);
    res.status(500).json({ message: 'Failed to load the game.' });
  }
};

const createGame = async (req, res) => {
  // #swagger.tags = ['Games']
  // #swagger.summary = 'Create a new game'
  // #swagger.description = 'All nine fields are required. maxPlayers must be greater than or equal to minPlayers, and any field not listed in the schema is ignored rather than stored.'
  /* #swagger.requestBody = {
       required: true,
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Game' } } }
  } */
  /* #swagger.responses[201] = {
       description: 'Game created. The body includes the new id, and the Location header points to it.',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/CreatedGame' } } }
  } */
  /* #swagger.responses[400] = {
       description: 'A field is missing or badly formatted. errors lists every problem found.',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  } */
  /* #swagger.responses[500] = {
       description: 'The database could not be reached',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  } */
  const { errors, document } = validateGame(req.body);

  if (errors.length > 0) {
    // 422 would also be defensible, but 400 is the status the course rubric and
    // most REST clients expect for a malformed body.
    return res.status(400).json({ message: 'Invalid game.', errors });
  }

  try {
    // Copy first: insertOne MUTATES the object it is given, adding an `_id`
    // property to it. Spreading `document` after the insert would put both `id`
    // and `_id` in the response.
    const created = { ...document };
    const result = await games().insertOne(document);

    // 201 Created is the correct status for "a new resource now exists".
    // The Location header points at that new resource — standard REST practice —
    // and the body repeats the id because it is what a caller needs next.
    res
      .status(201)
      .location(`/games/${result.insertedId}`)
      .json({ id: result.insertedId, ...created });
  } catch (err) {
    console.error('POST /games failed:', err);
    res.status(500).json({ message: 'Failed to create the game.' });
  }
};

const updateGame = async (req, res) => {
  // #swagger.tags = ['Games']
  // #swagger.summary = 'Replace an existing game'
  // #swagger.description = 'Replaces the whole game, so send all nine fields. The same validation rules as POST apply.'
  /* #swagger.parameters['id'] = {
       description: 'The game\'s MongoDB ObjectId (24 hex characters)',
       example: '000000000000000000000000'
  } */
  /* #swagger.requestBody = {
       required: true,
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Game' } } }
  } */
  // #swagger.responses[204] = { description: 'Game updated. There is no response body.' }
  /* #swagger.responses[400] = {
       description: 'The id is not a valid ObjectId, or a field is missing or badly formatted',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  } */
  /* #swagger.responses[404] = {
       description: 'No game has that id',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  } */
  /* #swagger.responses[500] = {
       description: 'The database could not be reached',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  } */
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid game ID.' });
  }

  const { errors, document } = validateGame(req.body);

  if (errors.length > 0) {
    return res.status(400).json({ message: 'Invalid game.', errors });
  }

  try {
    // replaceOne, not updateOne with $set: PUT means "make the resource look
    // exactly like this", so any field not in the body should disappear.
    const result = await games().replaceOne({ _id: new ObjectId(id) }, document);

    // matchedCount is the honest check. modifiedCount would be 0 when someone
    // PUTs data identical to what is already stored — a successful no-op, not a
    // missing game.
    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Game not found.' });
    }

    // 204 No Content: it worked, and there is deliberately nothing in the body.
    res.status(204).send();
  } catch (err) {
    console.error(`PUT /games/${id} failed:`, err);
    res.status(500).json({ message: 'Failed to update the game.' });
  }
};

const deleteGame = async (req, res) => {
  // #swagger.tags = ['Games']
  // #swagger.summary = 'Delete a game and all of its play sessions'
  // #swagger.description = 'Sessions reference a game by id, so deleting a game also deletes its sessions. Leaving them behind would orphan them, pointing at a game that no longer exists.'
  /* #swagger.parameters['id'] = {
       description: 'The game\'s MongoDB ObjectId (24 hex characters)',
       example: '000000000000000000000000'
  } */
  // #swagger.responses[204] = { description: 'Game deleted. There is no response body.' }
  /* #swagger.responses[400] = {
       description: 'The id is not a valid ObjectId',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  } */
  /* #swagger.responses[404] = {
       description: 'No game has that id',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  } */
  /* #swagger.responses[500] = {
       description: 'The database could not be reached',
       content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  } */
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid game ID.' });
  }

  try {
    const gameId = new ObjectId(id);
    const result = await games().deleteOne({ _id: gameId });

    // Returning 404 for an already-absent game tells the caller their id was
    // wrong, rather than silently pretending a delete happened.
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Game not found.' });
    }

    // Cascade. This runs only after the game is confirmed deleted, so a bad id
    // can never take sessions with it. The count goes to the log because a 204
    // response has no body to report it in.
    const cascaded = await sessions().deleteMany({ gameId });
    if (cascaded.deletedCount > 0) {
      console.log(`Deleted game ${id} and ${cascaded.deletedCount} of its session(s).`);
    }

    res.status(204).send();
  } catch (err) {
    console.error(`DELETE /games/${id} failed:`, err);
    res.status(500).json({ message: 'Failed to delete the game.' });
  }
};

module.exports = {
  getAllGames,
  getSingleGame,
  createGame,
  updateGame,
  deleteGame,
  // Exported so swagger.js can build the schema's `enum` from the same list the
  // validator checks against. If they were written out twice they would drift.
  COMPLEXITY_LEVELS,
  // Exported so data/seed.js can check its own fixtures against the very same
  // rules the API enforces. A seed script writes straight to Mongo and would
  // otherwise happily load data the API would have rejected.
  validateGame,
};
