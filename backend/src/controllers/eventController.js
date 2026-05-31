const Event = require('../models/Event');
const Camera = require('../models/Camera');
const { isDatabaseConnected } = require('../config/database');
const { DEMO_CAMERAS } = require('./cameraController');
const trafficService = require('../services/trafficService');
const floodService = require('../services/floodService');
const alertService = require('../services/alertService');

const VALID_EVENT_TYPES = ['traffic_jam', 'fire', 'flood'];

/**
 * POST /api/events
 *
 * Receives detection frames from AI modules:
 * { camera_id, event_type, confidence, vehicle_count?, avg_speed?, water_ratio?, image_base64, timestamp }
 *
 * Flow: validate -> service logic -> save history -> update active alert state
 */
function isClearSignal(body) {
  const status = String(body.status || body.state || '').toLowerCase();
  return (
    body.active === false ||
    body.resolved === true ||
    body.clear === true ||
    ['normal', 'resolved', 'clear', 'cleared', 'inactive'].includes(status)
  );
}

function clearDetectorState(cameraId, eventType) {
  if (eventType === 'traffic_jam') trafficService.clearWindow(cameraId);
  if (eventType === 'flood') floodService.resetState(cameraId);
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function distanceMeters(a, b) {
  const earthRadiusMeters = 6371000;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function getCameraCandidates() {
  if (!isDatabaseConnected()) return DEMO_CAMERAS;
  return Camera.find({ active: { $ne: false }, camera_id: { $ne: '' } })
    .select('-token_hash')
    .lean();
}

async function findCameraForReport({ camera_id, lat, lng }) {
  if (camera_id) {
    const camera = isDatabaseConnected()
      ? await Camera.findOne({ camera_id }).lean()
      : DEMO_CAMERAS.find((c) => c.camera_id === camera_id);
    if (camera) return { camera, distance: null };
  }

  const cameras = (await getCameraCandidates())
    .filter((camera) => camera.camera_id && camera.location);

  if (!cameras.length) return { camera: null, distance: null };

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const origin = { lat, lng };
    return cameras.reduce(
      (best, camera) => {
        const distance = distanceMeters(origin, {
          lat: Number(camera.location.lat),
          lng: Number(camera.location.lng),
        });
        return !best.camera || distance < best.distance ? { camera, distance } : best;
      },
      { camera: null, distance: Infinity }
    );
  }

  return { camera: cameras[0], distance: null };
}

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
    const clearSignal = isClearSignal(req.body);
    if (!camera_id || !event_type || (!clearSignal && confidence === undefined)) {
      return res.status(400).json({
        error: 'Missing required fields: camera_id, event_type, confidence',
      });
    }

    if (!VALID_EVENT_TYPES.includes(event_type)) {
      return res.status(400).json({
        error: `Invalid event_type. Must be one of: ${VALID_EVENT_TYPES.join(', ')}`,
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

    if (clearSignal) {
      clearDetectorState(camera_id, event_type);
      const clearResult = alertService.clearAlert(camera_id, event_type, {
        reason: 'camera_clear',
        timestamp: timestamp || new Date(),
        metadata: { source: 'camera_signal' },
      });

      return res.status(200).json({
        success: true,
        resolved: true,
        alert_cleared: clearResult.cleared,
        history_saved: false,
      });
    }

    let shouldAlert = false;
    let isActiveDetection = false;
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
        isActiveDetection = result.isJam;
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
        isActiveDetection = result.state !== floodService.STATES.NORMAL;
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
        isActiveDetection = confidence >= 0.6;
        shouldAlert = isActiveDetection;
        if (confidence >= 0.85) severity = 'critical';
        else if (confidence >= 0.7) severity = 'high';
        else severity = 'medium';
        metadata = { confidence };
        break;
      }
    }

    metadata = {
      ...metadata,
      active: isActiveDetection,
    };

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

    // --- Update active alert state ---
    let activeResult = { created: false };
    let clearResult = { cleared: false };
    if (isActiveDetection) {
      activeResult = alertService.upsertActiveAlert({
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
    } else {
      clearResult = alertService.clearAlert(camera_id, event_type, {
        reason: 'not_detected',
        timestamp: eventDoc.timestamp,
        metadata: { source: 'detection_frame' },
      });
    }

    return res.status(201).json({
      success: true,
      event_id: eventDoc._id,
      alert_triggered: shouldAlert,
      active: isActiveDetection,
      alert_created: activeResult.created,
      alert_cleared: clearResult.cleared,
      severity,
    });
  } catch (err) {
    console.error('[EventController] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/events?camera_id=&event_type=&from=&to=&limit=50
 */
async function getEvents(req, res) {
  try {
    if (!isDatabaseConnected()) {
      return res.json({ events: [], demo: true });
    }

    const { camera_id, event_type, from, to, limit = 50 } = req.query;

    const filter = {};
    if (camera_id) filter.camera_id = camera_id;
    if (event_type) filter.event_type = event_type;
    if (from || to) {
      filter.timestamp = {};
      if (from) {
        const fromDate = new Date(from);
        if (!Number.isNaN(fromDate.getTime())) filter.timestamp.$gte = fromDate;
      }
      if (to) {
        const toDate = new Date(to);
        if (!Number.isNaN(toDate.getTime())) filter.timestamp.$lte = toDate;
      }
      if (!Object.keys(filter.timestamp).length) delete filter.timestamp;
    }

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 1000);

    const events = await Event.find(filter)
      .sort({ timestamp: -1 })
      .limit(safeLimit)
      .select('-image_base64') // exclude heavy field in list
      .lean();

    return res.json({ events });
  } catch (err) {
    console.error('[EventController] Error:', err);
    return res.json({ events: [], demo: true });
  }
}

/**
 * POST /api/events/emergency
 *
 * Public user report endpoint for urgent incidents.
 */
async function createEmergencyEvent(req, res) {
  try {
    const {
      camera_id,
      event_type,
      lat,
      lng,
      note,
      timestamp,
    } = req.body;

    if (!VALID_EVENT_TYPES.includes(event_type)) {
      return res.status(400).json({
        error: `Invalid event_type. Must be one of: ${VALID_EVENT_TYPES.join(', ')}`,
      });
    }

    const reportLat = toFiniteNumber(lat);
    const reportLng = toFiniteNumber(lng);
    const { camera, distance } = await findCameraForReport({
      camera_id,
      lat: reportLat,
      lng: reportLng,
    });

    if (!camera) {
      return res.status(404).json({ error: 'No camera is available for this report' });
    }

    const eventTimestamp = timestamp ? new Date(timestamp) : new Date();
    const safeTimestamp = Number.isNaN(eventTimestamp.getTime()) ? new Date() : eventTimestamp;
    const alertLat = Number.isFinite(reportLat) ? reportLat : camera.location.lat;
    const alertLng = Number.isFinite(reportLng) ? reportLng : camera.location.lng;
    const severity = event_type === 'fire' ? 'critical' : 'high';
    const confidence = 1;
    const metadata = {
      active: true,
      source: 'user_emergency',
      note: String(note || '').slice(0, 500),
      report_location: Number.isFinite(reportLat) && Number.isFinite(reportLng)
        ? { lat: reportLat, lng: reportLng }
        : null,
      nearest_camera_distance_m: Number.isFinite(distance) ? Math.round(distance) : null,
    };

    let eventDoc = {
      _id: `emergency_${Date.now()}`,
      camera_id: camera.camera_id,
      event_type,
      severity,
      confidence,
      metadata,
      timestamp: safeTimestamp,
    };

    if (isDatabaseConnected()) {
      eventDoc = await Event.create({
        camera_id: camera.camera_id,
        event_type,
        severity,
        confidence,
        image_base64: null,
        metadata,
        timestamp: safeTimestamp,
      });
    }

    const activeResult = alertService.upsertActiveAlert({
      camera_id: camera.camera_id,
      event_type,
      severity,
      image_base64: null,
      lat: alertLat,
      lng: alertLng,
      camera_name: camera.name,
      timestamp: eventDoc.timestamp,
      metadata,
    });

    return res.status(201).json({
      success: true,
      event_id: eventDoc._id,
      alert_created: activeResult.created,
      active: true,
      severity,
      nearest_camera: {
        camera_id: camera.camera_id,
        name: camera.name,
        distance_m: Number.isFinite(distance) ? Math.round(distance) : null,
      },
      alert: activeResult.alert,
    });
  } catch (err) {
    console.error('[EventController] Emergency error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/events/active
 */
async function getActiveEvents(_req, res) {
  return res.json({ alerts: alertService.getActiveAlerts() });
}

module.exports = { createEvent, createEmergencyEvent, getEvents, getActiveEvents };
