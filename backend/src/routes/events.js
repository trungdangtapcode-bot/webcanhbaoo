const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { createEvent, getEvents } = require('../controllers/eventController');

// POST /api/events — requires JWT
router.post('/', authMiddleware, createEvent);

// GET /api/events — public (for dashboard)
router.get('/', getEvents);

// DELETE /api/events — clear all events (for testing)
router.delete('/', async (req, res) => {
  const Event = require('../models/Event');
  try {
    await Event.deleteMany({});
    res.json({ success: true, message: 'All events cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
