/**
 * Alert Service - Socket.io emission plus active incident state.
 *
 * Push one notification when an incident is first detected. Later detector
 * hits are treated as heartbeats, and operator queue items remain until a user
 * explicitly deletes them.
 */

let ioInstance = null;
const alertQueueService = require('./alertQueueService');
const emailAlertService = require('./emailAlertService');

// Map<`${camera_id}:${event_type}`, activeAlert>
const activeAlerts = new Map();

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const DEFAULT_TTL_MS = parsePositiveInt(process.env.ACTIVE_ALERT_TTL_MS, 900000);
const CLEAR_HEARTBEATS_REQUIRED = parsePositiveInt(process.env.ALERT_CLEAR_HEARTBEATS, 3);
const EVENT_TTL_MS = {
  fire: parsePositiveInt(process.env.FIRE_ALERT_TTL_MS, DEFAULT_TTL_MS),
  flood: parsePositiveInt(process.env.FLOOD_ALERT_TTL_MS, DEFAULT_TTL_MS),
  traffic_jam: parsePositiveInt(process.env.TRAFFIC_ALERT_TTL_MS, DEFAULT_TTL_MS),
};

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
  const { timer: _timer, ...payload } = entry;
  return payload;
}

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
      force: true,
      reason: 'stale',
      timestamp: new Date(),
      metadata: { stale_after_ms: ttlMs },
    });
  }, ttlMs);

  if (typeof entry.timer.unref === 'function') entry.timer.unref();
}

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
    timestamp: existing?.timestamp || now,
    first_seen: existing?.first_seen || now,
    last_seen: now,
    active: true,
    clear_heartbeats: 0,
    metadata: {
      ...(existing?.metadata || {}),
      ...(alertData.metadata || {}),
      ttl_ms: ttlMs,
    },
    timer: existing?.timer || null,
  };

  activeAlerts.set(key, entry);
  scheduleExpiry(key, ttlMs);

  const payload = serializeAlert(entry);
  const queueItem = alertQueueService.upsertFromAlert(payload);

  if (!existing) {
    if (ioInstance) ioInstance.emit('alert', { ...payload, queue_status: queueItem.status });
    else console.error('[AlertService] Socket.io not initialized');
    emailAlertService.notifyAlert(payload);
    console.log(`[AlertService] alert: ${payload.event_type} @ ${payload.camera_id} (${payload.severity})`);
    return { created: true, alert: payload };
  }

  console.log(`[AlertService] heartbeat: ${payload.event_type} @ ${payload.camera_id}`);
  return { created: false, alert: payload };
}

function clearAlert(cameraId, eventType, options = {}) {
  const key = makeKey(cameraId, eventType);
  const entry = activeAlerts.get(key);
  if (!entry) return { cleared: false };

  const force = options.force === true;
  const nextHeartbeat = (entry.clear_heartbeats || 0) + 1;
  if (!force && nextHeartbeat < CLEAR_HEARTBEATS_REQUIRED) {
    entry.clear_heartbeats = nextHeartbeat;
    entry.last_seen = normalizeTimestamp(options.timestamp);
    entry.metadata = {
      ...(entry.metadata || {}),
      ...(options.metadata || {}),
      clear_heartbeats: nextHeartbeat,
      clear_heartbeats_required: CLEAR_HEARTBEATS_REQUIRED,
    };
    activeAlerts.set(key, entry);
    scheduleExpiry(key, getAlertTtlMs(eventType));
    console.log(
      `[AlertService] clear heartbeat ${nextHeartbeat}/${CLEAR_HEARTBEATS_REQUIRED}: ${eventType} @ ${cameraId}`
    );
    return { cleared: false, pending: true, alert: serializeAlert(entry) };
  }

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
      clear_heartbeats: force ? entry.clear_heartbeats || 0 : nextHeartbeat,
      clear_heartbeats_required: CLEAR_HEARTBEATS_REQUIRED,
    },
  };

  if (ioInstance) ioInstance.emit('alert_cleared', payload);
  else console.error('[AlertService] Socket.io not initialized');

  console.log(`[AlertService] alert_cleared: ${payload.event_type} @ ${payload.camera_id} (${payload.reason})`);
  return { cleared: true, alert: payload };
}

function getActiveAlerts() {
  return Array.from(activeAlerts.values())
    .map(serializeAlert)
    .sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
}

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
