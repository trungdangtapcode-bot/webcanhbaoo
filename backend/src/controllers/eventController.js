const Event = require('../models/Event');
const Camera = require('../models/Camera');
const { isDatabaseConnected } = require('../config/database');
const { DEMO_CAMERAS } = require('./cameraController');
const trafficService = require('../services/trafficService');
const floodService = require('../services/floodService');
const alertService = require('../services/alertService');

/**
 * POST /api/events
 *
 * Receives detection frames from AI modules:
 * { camera_id, event_type, confidence, vehicle_count?, avg_speed?, water_ratio?, image_base64, timestamp }
 *
 * Flow: validate → service logic → save → conditionally emit alert
 */
async function createEvent(req, res) {
  try {
    const {
      camera_id,
      event_type,
      confidence,
      vehicle_count,
      avg_speed,
      water_ratio,
      image_base64,
      timestamp,
    } = req.body;

    // --- Validation ---
    if (!camera_id || !event_type || confidence === undefined) {
      return res.status(400).json({
        error: 'Missing required fields: camera_id, event_type, confidence',
      });
    }

    const validTypes = ['traffic_jam', 'fire', 'flood'];
    if (!validTypes.includes(event_type)) {
      return res.status(400).json({
        error: `Invalid event_type. Must be one of: ${validTypes.join(', ')}`,
      });
    }

    // --- Look up camera (DB or demo fallback) ---
    let camera;
    if (isDatabaseConnected()) {
      camera = await Camera.findOne({ camera_id });
    } else {
      camera = DEMO_CAMERAS.find((c) => c.camera_id === camera_id);
    }

    if (!camera) {
      return res.status(404).json({ error: `Camera ${camera_id} not found` });
    }

    let shouldAlert = false;
    let severity = 'medium';
    let metadata = {};

    // --- Service logic by event type ---
    switch (event_type) {
      case 'traffic_jam': {
        const result = trafficService.evaluate(
          camera_id,
          { avg_speed, vehicle_count, timestamp },
          camera.max_red_light_time
        );
        shouldAlert = result.isJam;
        severity = result.severity;
        metadata = {
          avg_speed,
          vehicle_count,
          duration: result.duration,
        };
        break;
      }

      case 'flood': {
        const ratio = water_ratio || 0;
        const result = floodService.evaluate(camera_id, ratio);
        shouldAlert = result.shouldAlert;
        severity = result.severity;
        metadata = {
          water_ratio: ratio,
          state: result.state,
          prev_state: result.prevState,
        };
        break;
      }

      case 'fire': {
        // Fire: any confidence >= 0.6 triggers alert
        shouldAlert = confidence >= 0.6;
        if (confidence >= 0.85) severity = 'critical';
        else if (confidence >= 0.7) severity = 'high';
        else severity = 'medium';
        metadata = { confidence };
        break;
      }
    }

    // --- Save event to MongoDB (if connected) ---
    let eventDoc = {
      _id: `demo_${Date.now()}`,
      camera_id,
      event_type,
      severity,
      confidence,
      metadata,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
    };

    if (isDatabaseConnected()) {
      const saved = await Event.create({
        camera_id,
        event_type,
        severity,
        confidence,
        image_base64: image_base64 || null,
        metadata,
        timestamp: timestamp ? new Date(timestamp) : new Date(),
      });
      eventDoc = saved;
    }

    // --- Emit alert if triggered ---
    if (shouldAlert) {
      alertService.emitAlert({
        camera_id,
        event_type,
        severity,
        image_base64: image_base64 || null,
        lat: camera.location.lat,
        lng: camera.location.lng,
        camera_name: camera.name,
        timestamp: eventDoc.timestamp,
        metadata,
      });
    }

    return res.status(201).json({
      success: true,
      event_id: eventDoc._id,
      alert_triggered: shouldAlert,
      severity,
    });
  } catch (err) {
    console.error('[EventController] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/events?camera_id=&event_type=&limit=50
 */
async function getEvents(req, res) {
  try {
    if (!isDatabaseConnected()) {
      return res.json({ events: [], demo: true });
    }

    const { camera_id, event_type, limit = 50 } = req.query;

    const filter = {};
    if (camera_id) filter.camera_id = camera_id;
    if (event_type) filter.event_type = event_type;

    const events = await Event.find(filter)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit, 10))
      .select('-image_base64') // exclude heavy field in list
      .lean();

    return res.json({ events });
  } catch (err) {
    console.error('[EventController] Error:', err);
    return res.json({ events: [], demo: true });
  }
}

module.exports = { createEvent, getEvents };
