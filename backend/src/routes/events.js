const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const {
  createEvent,
  createEmergencyEvent,
  getAlertQueue,
  getEvents,
  getActiveEvents,
  updateAlertQueueItem,
} = require('../controllers/eventController');

// POST /api/events - requires JWT
router.post('/', authMiddleware, createEvent);

// POST /api/events/emergency - public urgent user report
router.post('/emergency', createEmergencyEvent);

// GET /api/events/active - public current map state
router.get('/active', getActiveEvents);

// GET /api/events/queue - operator triage queue
router.get('/queue', getAlertQueue);

// PATCH /api/events/queue/:camera_id/:event_type - update operator status
router.patch('/queue/:camera_id/:event_type', updateAlertQueueItem);

// GET /api/events - public history for dashboard, reports, and statistics
router.get('/', getEvents);

module.exports = router;
