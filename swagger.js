/**
 * Generates swagger-output.json by reading the route files.
 *
 * Run it with `npm run swagger` any time the routes change — the generated file
 * is a *snapshot*, not something the server works out at startup. Committing
 * that snapshot means Render serves documentation without needing to run this
 * script during deployment.
 *
 * Note the `{ openapi: '3.0.0' }` option. Without it swagger-autogen emits the
 * old Swagger 2.0 format, which is what most CSE 341 examples show. OpenAPI 3 is
 * the current standard — it is where `components.schemas` and `requestBody`
 * come from, both of which this file uses.
 */
const swaggerAutogen = require('swagger-autogen')({ openapi: '3.0.0' });

// Imported rather than retyped so the documented `enum` and the list the
// validator actually enforces can never disagree.
const { COMPLEXITY_LEVELS } = require('./controllers/games');

// Written out once and reused by the three Game schemas below. `required` lists
// every field because POST and PUT both demand a complete document.
const gameProperties = {
  title: { type: 'string', example: 'Wingspan' },
  publisher: { type: 'string', example: 'Stonemaier Games' },
  yearPublished: { type: 'integer', example: 2019, minimum: 1900 },
  minPlayers: { type: 'integer', example: 1, minimum: 1 },
  maxPlayers: {
    type: 'integer',
    example: 5,
    minimum: 1,
    description: 'Must be greater than or equal to minPlayers.',
  },
  playTimeMinutes: { type: 'integer', example: 70, minimum: 1 },
  complexity: { type: 'string', enum: COMPLEXITY_LEVELS, example: 'medium' },
  categories: {
    type: 'array',
    items: { type: 'string' },
    minItems: 1,
    example: ['strategy', 'engine-building'],
  },
  ownerEmail: { type: 'string', format: 'email', example: 'reese@example.com' },
};

const sessionProperties = {
  gameId: {
    type: 'string',
    description: 'The _id of an existing game. A game with this id must already exist.',
    example: '000000000000000000000000',
  },
  playedOn: {
    type: 'string',
    format: 'date',
    description: 'YYYY-MM-DD. Cannot be in the future.',
    example: '2026-09-19',
  },
  players: {
    type: 'array',
    items: { type: 'string' },
    minItems: 1,
    example: ['Reese', 'Sam', 'Jordan'],
  },
  winner: {
    type: 'string',
    description: 'Must be one of the names in players.',
    example: 'Sam',
  },
  durationMinutes: { type: 'integer', example: 82, minimum: 1 },
  notes: {
    type: 'string',
    maxLength: 500,
    description: 'Optional. The only field that may be omitted.',
    example: 'Close game, decided on the last round.',
  },
};

// `_id` is what MongoDB stores and what every GET returns; `id` is the shorthand
// the POST response repeats for convenience. Both are the same 24-hex value.
const withMongoId = (schemaName) => ({
  allOf: [
    {
      type: 'object',
      properties: {
        _id: {
          type: 'string',
          description: 'MongoDB ObjectId (24 hex characters)',
          example: '000000000000000000000000',
        },
      },
    },
    { $ref: `#/components/schemas/${schemaName}` },
  ],
});

const withCreatedId = (schemaName) => ({
  allOf: [
    {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ObjectId of the newly created document',
          example: '000000000000000000000000',
        },
      },
    },
    { $ref: `#/components/schemas/${schemaName}` },
  ],
});

const doc = {
  info: {
    title: 'CSE 341 Board Game Library API',
    version: '1.0.0',
    description:
      'A REST API for a board game collection and the play sessions logged against it, ' +
      'backed by MongoDB Atlas. Built for CSE 341 Web Services, project 2.\n\n' +
      'Two collections: **games** (nine fields) and **sessions** (six). A session references ' +
      'its game by `gameId`, so creating one requires a game that already exists, and deleting ' +
      'a game also deletes its sessions.\n\n' +
      'Every POST and PUT validates its whole body and answers `400` with an `errors` array ' +
      'listing every problem found, not just the first one.',
  },

  // A relative server URL is resolved against wherever these docs are being
  // served from. One entry therefore covers both http://localhost:8080 and the
  // Render deployment, so "Try it out" always calls the right host and there is
  // no hard-coded URL to forget to update.
  servers: [{ url: '/', description: 'This server (localhost or Render)' }],

  tags: [
    { name: 'Root', description: 'Welcome message and health check' },
    { name: 'Games', description: 'The board game collection — create, read, update, delete' },
    { name: 'Sessions', description: 'Play sessions logged against a game' },
  ],

  components: {
    schemas: {
      // Defined once and referenced by $ref from the controllers, so each
      // request body shape is documented in exactly one place.
      Game: {
        type: 'object',
        required: Object.keys(gameProperties),
        properties: gameProperties,
      },
      GameWithId: withMongoId('Game'),
      CreatedGame: withCreatedId('Game'),

      Session: {
        type: 'object',
        // Everything except notes, which is the one optional field.
        required: Object.keys(sessionProperties).filter((field) => field !== 'notes'),
        properties: sessionProperties,
      },
      SessionWithId: withMongoId('Session'),
      CreatedSession: withCreatedId('Session'),

      Error: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'A short summary of what went wrong.',
            example: 'Invalid game.',
          },
          errors: {
            type: 'array',
            description:
              'Present on validation failures only: one entry per problem found in the body.',
            items: { type: 'string' },
            example: [
              '"title" is required and must be a non-empty string.',
              '"maxPlayers" must be greater than or equal to "minPlayers".',
            ],
          },
        },
      },
    },
  },
};

const outputFile = './swagger-output.json';

// Only the root route file is listed. swagger-autogen follows the
// `router.use('/games', require('./games'))` calls from there, which is how it
// learns that the games routes live under the /games prefix. Listing
// routes/games.js directly would document it as "/" and "/{id}" instead.
const routes = ['./routes/index.js'];

/**
 * Tidies the generated paths.
 *
 * A collection route is written `router.get('/')` inside a router mounted at
 * `/games`, so swagger-autogen joins the two into `/games/` with a trailing
 * slash. Express treats `/games` and `/games/` as the same route, so the docs
 * still work — but every path reads with a stray slash, which looks like a bug
 * in the documentation. Renaming the keys afterwards is simpler and less
 * fragile than fighting the generator's path joining.
 */
const stripTrailingSlashes = (generated) => {
  const paths = {};

  for (const [path, operations] of Object.entries(generated.paths)) {
    const key = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;

    // Merge rather than assign, in case both `/games` and `/games/` were
    // produced — otherwise one would silently overwrite the other.
    paths[key] = { ...paths[key], ...operations };
  }

  generated.paths = paths;
  return generated;
};

/**
 * Removes phantom query parameters.
 *
 * This works around a real swagger-autogen v2 bug. Once an operation declares a
 * *query* parameter (a path parameter is fine, because the generator already
 * knows those from the route), its parameter scanner sweeps the rest of the
 * handler and turns the top-level keys of the neighbouring `#swagger.responses`
 * blocks into parameters of their own — producing query parameters named
 * "description" and "content" on GET /sessions. Reordering the annotations and
 * collapsing them onto one line both fail to prevent it.
 *
 * The rule below is narrow: a real query parameter in this project is always
 * authored with a description, so anything lacking both a description and an
 * example is generator noise. Every removal is logged rather than dropped
 * quietly, so if this ever discards something real you will see it happen.
 */
const removePhantomParameters = (generated) => {
  const removed = [];

  for (const [path, operations] of Object.entries(generated.paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      if (!Array.isArray(operation.parameters)) continue;

      operation.parameters = operation.parameters.filter((parameter) => {
        const isPhantom =
          parameter.in === 'query' && !parameter.description && parameter.example === undefined;

        if (isPhantom) removed.push(`${method.toUpperCase()} ${path} ?${parameter.name}`);
        return !isPhantom;
      });

      if (operation.parameters.length === 0) delete operation.parameters;
    }
  }

  if (removed.length > 0) {
    console.log(`Swagger: dropped ${removed.length} phantom parameter(s): ${removed.join(', ')}`);
  }

  return generated;
};

swaggerAutogen(outputFile, routes, doc).then(() => {
  const fs = require('fs');

  const generated = removePhantomParameters(
    stripTrailingSlashes(JSON.parse(fs.readFileSync(outputFile, 'utf8'))),
  );

  fs.writeFileSync(outputFile, `${JSON.stringify(generated, null, 2)}\n`);
  console.log(`Swagger: ${Object.keys(generated.paths).length} paths written to ${outputFile}`);
});
