const router = require('express').Router();

const sessionsController = require('../controllers/sessions');

// Mounted at /sessions in routes/index.js.
router.get('/', sessionsController.getAllSessions);
router.post('/', sessionsController.createSession);

router.get('/:id', sessionsController.getSingleSession);
router.put('/:id', sessionsController.updateSession);
router.delete('/:id', sessionsController.deleteSession);

module.exports = router;
