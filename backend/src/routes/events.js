const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const {
  createEvent,
  getAlertQueue,
  getEvents,
  getActiveEvents,
  deleteAlertQueueItem,
  updateAlertQueueItem,
} = require('../controllers/eventController');

// POST /api/events - requires JWT
console.log('[DEBUG events.js] authMiddleware type:', typeof authMiddleware, authMiddleware);
console.log('[DEBUG events.js] createEvent type:', typeof createEvent, createEvent);

router.post('/', 
  typeof authMiddleware === 'function' ? authMiddleware : (req, res, next) => next(), 
  typeof createEvent === 'function' ? createEvent : (req, res) => res.status(500).json({ error: 'createEvent is not a function' })
);

// GET /api/events/active - public current map state
router.get('/active', getActiveEvents);

// GET /api/events/queue - operator triage queue
router.get('/queue', getAlertQueue);

// PATCH /api/events/queue/:camera_id/:event_type - update operator status
router.patch('/queue/:camera_id/:event_type', updateAlertQueueItem);

// DELETE /api/events/queue/:camera_id/:event_type - remove operator queue item
router.delete('/queue/:camera_id/:event_type', deleteAlertQueueItem);

// GET /api/events - public history for dashboard, reports, and statistics
router.get('/', getEvents);

module.exports = router;
