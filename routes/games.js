const router = require('express').Router();

const gamesController = require('../controllers/games');

// Mounted at /games in routes/index.js. The same path can carry different
// methods — that is the core REST idea: the URL names the *thing*, the HTTP
// method names what you want done to it.
router.get('/', gamesController.getAllGames);
router.post('/', gamesController.createGame);

router.get('/:id', gamesController.getSingleGame);
router.put('/:id', gamesController.updateGame);
router.delete('/:id', gamesController.deleteGame);

module.exports = router;
