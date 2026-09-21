const router = require('express').Router();

const swaggerDocument = require('../swagger-output.json');

router.get('/', (req, res) => {
  // #swagger.tags = ['Root']
  // #swagger.summary = 'API welcome message'
  // #swagger.description = 'Also doubles as the Render health check endpoint.'
  res.send('CSE 341 — Board Game Library API. Documentation is at /api-docs');
});

// The raw OpenAPI document. swagger-ui-express serves its own HTML page for
// every path under /api-docs — including /api-docs/swagger.json — so without
// this there is no URL that returns the actual spec. Publishing it lets other
// tools (Postman, a code generator, a grader) import the API directly.
router.get('/swagger.json', (req, res) => {
  // #swagger.tags = ['Root']
  // #swagger.summary = 'The raw OpenAPI 3 document that powers /api-docs'
  res.json(swaggerDocument);
});

// swagger-autogen follows these `router.use` calls from this file, which is how
// it learns that the games routes live under the /games prefix. That is why
// swagger.js lists only this file and not the ones below.
router.use('/games', require('./games'));
router.use('/sessions', require('./sessions'));

module.exports = router;
