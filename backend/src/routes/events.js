const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { createEvent, getEvents } = require('../controllers/eventController');

// POST /api/events — requires JWT
router.post('/', authMiddleware, createEvent);

// GET /api/events — public (for dashboard)
router.get('/', getEvents);

module.exports = router;
