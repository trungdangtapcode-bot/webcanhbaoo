/**
 * Alert Service - Socket.io emission plus active incident state.
 *
 * The dashboard should show map alert icons only while an incident is active.
 * Historical Event documents remain in MongoDB for reports and statistics.
 */

let ioInstance = null;

// Map<`${camera_id}:${event_type}`, activeAlert>
const activeAlerts = new Map();

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const DEFAULT_TTL_MS = parsePositiveInt(process.env.ACTIVE_ALERT_TTL_MS, 900000);
const EVENT_TTL_MS = {
  fire: parsePositiveInt(process.env.FIRE_ALERT_TTL_MS, DEFAULT_TTL_MS),
  flood: parsePositiveInt(process.env.FLOOD_ALERT_TTL_MS, DEFAULT_TTL_MS),
  traffic_jam: parsePositiveInt(process.env.TRAFFIC_ALERT_TTL_MS, DEFAULT_TTL_MS),
};

// Minimum time between alert_update emissions for the same alert (avoid scan spam)
const UPDATE_COOLDOWN_MS = parsePositiveInt(process.env.ALERT_UPDATE_COOLDOWN_MS, 5 * 60 * 1000);

function getAlertTtlMs(eventType) {
  return EVENT_TTL_MS[eventType] || DEFAULT_TTL_MS;
}

function makeKey(cameraId, eventType) {
  return `${cameraId}:${eventType}`;
}

function normalizeTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function serializeAlert(entry) {
  // Exclude internal fields: timer (setTimeout handle) and _lastEmittedAt (throttle tracker)
  const { timer: _timer, _lastEmittedAt: _lea, ...payload } = entry;
  return payload;
}

/**
 * Initialize with the Socket.io server instance.
 * @param {import('socket.io').Server} io
 */
function init(io) {
  ioInstance = io;
  console.log('[AlertService] Initialized');
}

function scheduleExpiry(key, ttlMs) {
  const entry = activeAlerts.get(key);
  if (!entry) return;

  if (entry.timer) clearTimeout(entry.timer);

  entry.timer = setTimeout(() => {
    clearAlert(entry.camera_id, entry.event_type, {
      reason: 'stale',
      timestamp: new Date(),
      metadata: { stale_after_ms: ttlMs },
    });
  }, ttlMs);

  if (typeof entry.timer.unref === 'function') {
    entry.timer.unref();
  }
}

/**
 * Create or refresh an active alert. New alerts emit `alert`; refreshes emit
 * `alert_update` so clients can keep the map icon alive without duplicating
 * the visible alert history.
 *
 * @param {object} alertData
 * @param {object} [options]
 * @param {number} [options.ttlMs]
 * @returns {{ created: boolean, alert: object }}
 */
function upsertActiveAlert(alertData, options = {}) {
  const key = makeKey(alertData.camera_id, alertData.event_type);
  const existing = activeAlerts.get(key);
  const now = normalizeTimestamp(alertData.timestamp);
  const ttlMs = options.ttlMs || getAlertTtlMs(alertData.event_type);

  const entry = {
    camera_id: alertData.camera_id,
    event_type: alertData.event_type,
    severity: alertData.severity || 'medium',
    image_base64: alertData.image_base64 || null,
    lat: alertData.lat,
    lng: alertData.lng,
    camera_name: alertData.camera_name || alertData.camera_id,
    timestamp: now,
    first_seen: existing?.first_seen || now,
    last_seen: now,
    active: true,
    metadata: {
      ...(existing?.metadata || {}),
      ...(alertData.metadata || {}),
      ttl_ms: ttlMs,
    },
    timer: existing?.timer || null,
    // Track last time we emitted an update so we can throttle update spam
    _lastEmittedAt: existing?._lastEmittedAt || null,
  };

  activeAlerts.set(key, entry);
  scheduleExpiry(key, ttlMs);

  const payload = serializeAlert(entry);

  if (!existing) {
    // Brand-new alert — always emit immediately
    if (ioInstance) ioInstance.emit('alert', payload);
    else console.error('[AlertService] Socket.io not initialized');
    entry._lastEmittedAt = Date.now();
    console.log(`[AlertService] alert: ${payload.event_type} @ ${payload.camera_id} (${payload.severity})`);
    return { created: true, alert: payload };
  }

  // Existing alert — check if we should emit an update
  const severityRank = { low: 0, medium: 1, high: 2, critical: 3 };
  const severityEscalated =
    (severityRank[alertData.severity] ?? 1) > (severityRank[existing.severity] ?? 1);
  const cooldownElapsed =
    !entry._lastEmittedAt || (Date.now() - entry._lastEmittedAt) >= UPDATE_COOLDOWN_MS;

  if (severityEscalated || cooldownElapsed) {
    if (ioInstance) ioInstance.emit('alert_update', payload);
    else console.error('[AlertService] Socket.io not initialized');
    entry._lastEmittedAt = Date.now();
    console.log(`[AlertService] alert_update: ${payload.event_type} @ ${payload.camera_id} (${payload.severity})`);
  } else {
    console.log(
      `[AlertService] alert_update suppressed (cooldown): ${payload.event_type} @ ${payload.camera_id}`
    );
  }

  return { created: false, alert: payload };
}

/**
 * Clear an active alert and notify connected clients to remove the map icon.
 *
 * @param {string} cameraId
 * @param {string} eventType
 * @param {object} [options]
 * @returns {{ cleared: boolean, alert?: object }}
 */
function clearAlert(cameraId, eventType, options = {}) {
  const key = makeKey(cameraId, eventType);
  const entry = activeAlerts.get(key);
  if (!entry) return { cleared: false };

  if (entry.timer) clearTimeout(entry.timer);
  activeAlerts.delete(key);

  const payload = {
    ...serializeAlert(entry),
    active: false,
    timestamp: normalizeTimestamp(options.timestamp),
    reason: options.reason || 'resolved',
    metadata: {
      ...(entry.metadata || {}),
      ...(options.metadata || {}),
    },
  };

  if (ioInstance) {
    ioInstance.emit('alert_cleared', payload);
  } else {
    console.error('[AlertService] Socket.io not initialized');
  }

  console.log(
    `[AlertService] alert_cleared: ${payload.event_type} @ ${payload.camera_id} (${payload.reason})`
  );

  return { cleared: true, alert: payload };
}

function getActiveAlerts() {
  return Array.from(activeAlerts.values())
    .map(serializeAlert)
    .sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
}

// Backwards-compatible name for older callers.
function emitAlert(alertData) {
  return upsertActiveAlert(alertData);
}

module.exports = {
  init,
  emitAlert,
  upsertActiveAlert,
  clearAlert,
  getActiveAlerts,
  getAlertTtlMs,
};
