const VALID_STATUSES = new Set(['new', 'in_progress', 'confirmed', 'false_alarm', 'resolved']);
const AlertQueueItem = require('../models/AlertQueueItem');
const { isDatabaseConnected } = require('../config/database');

const queue = new Map();

function makeKey(cameraId, eventType) {
  return `${cameraId}:${eventType}`;
}

function normalizeStatus(status, fallback = 'new') {
  return VALID_STATUSES.has(status) ? status : fallback;
}

function serialize(entry) {
  return {
    camera_id: entry.camera_id,
    camera_name: entry.camera_name,
    event_type: entry.event_type,
    severity: entry.severity,
    status: entry.status,
    confidence: entry.confidence,
    first_seen: normalizeDateString(entry.first_seen),
    last_seen: normalizeDateString(entry.last_seen),
    updated_at: normalizeDateString(entry.updated_at),
    assignee: entry.assignee,
    note: entry.note,
    metadata: entry.metadata || {},
  };
}

function isUnverifiedVisionIncident(entry) {
  if (!['fire', 'flood'].includes(entry.event_type)) return false;
  const metadata = entry.metadata || {};
  if (metadata.simulated_source || metadata.simulated_demo_fallback) return false;
  const detectorOrigin = Boolean(
    metadata.detector ||
    metadata.detector_url_configured ||
    metadata.ai_status ||
    metadata.ai_provider ||
    metadata.scanner
  );
  return detectorOrigin && metadata.verified_by_ai !== true;
}

function visibleQueueItems(items) {
  return items.filter((entry) => !isUnverifiedVisionIncident(entry));
}

function normalizeDateString(value) {
  if (!value) return new Date().toISOString();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function cacheEntry(entry) {
  queue.set(makeKey(entry.camera_id, entry.event_type), serialize(entry));
}

function persistQueueItem(entry) {
  if (!isDatabaseConnected()) return;
  AlertQueueItem.findOneAndUpdate(
    { camera_id: entry.camera_id, event_type: entry.event_type },
    {
      $set: {
        camera_name: entry.camera_name,
        confidence: entry.confidence,
        last_seen: entry.last_seen,
        metadata: entry.metadata || {},
        severity: entry.severity,
        status: entry.status,
        updated_at: entry.updated_at,
      },
      $setOnInsert: {
        camera_id: entry.camera_id,
        event_type: entry.event_type,
        first_seen: entry.first_seen,
        assignee: entry.assignee || null,
        note: entry.note || '',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).catch((err) => {
    console.error('[AlertQueue] persistence failed:', err.message);
  });
}

function upsertFromAlert(alertData) {
  const key = makeKey(alertData.camera_id, alertData.event_type);
  const existing = queue.get(key);
  const now = new Date().toISOString();
  const entry = {
    camera_id: alertData.camera_id,
    camera_name: alertData.camera_name || alertData.camera_id,
    confidence: alertData.confidence ?? existing?.confidence ?? null,
    event_type: alertData.event_type,
    first_seen: existing?.first_seen || alertData.first_seen || alertData.timestamp || now,
    last_seen: alertData.last_seen || alertData.timestamp || now,
    metadata: {
      ...(existing?.metadata || {}),
      ...(alertData.metadata || {}),
    },
    severity: alertData.severity || existing?.severity || 'medium',
    status: existing && existing.status !== 'resolved' ? existing.status : 'new',
    updated_at: now,
    assignee: existing?.assignee || null,
    note: existing?.note || '',
  };

  const serialized = serialize(entry);
  queue.set(key, serialized);
  persistQueueItem(serialized);
  return serialized;
}

async function markResolved(cameraId, eventType, metadata = {}) {
  const key = makeKey(cameraId, eventType);
  const entry = queue.get(key);
  if (!entry) return null;

  entry.status = 'resolved';
  entry.updated_at = new Date().toISOString();
  entry.metadata = { ...(entry.metadata || {}), ...metadata };
  const serialized = serialize(entry);
  queue.set(key, serialized);
  persistQueueItem(serialized);
  return serialized;
}

async function updateQueueItem(cameraId, eventType, updates = {}) {
  const key = makeKey(cameraId, eventType);
  let entry = queue.get(key);
  if (!entry && isDatabaseConnected()) {
    entry = await AlertQueueItem.findOne({ camera_id: cameraId, event_type: eventType }).lean();
  }
  if (!entry) return null;

  entry.status = normalizeStatus(updates.status, entry.status);
  if (updates.assignee !== undefined) entry.assignee = String(updates.assignee || '').slice(0, 80) || null;
  if (updates.note !== undefined) entry.note = String(updates.note || '').slice(0, 500);
  entry.updated_at = new Date().toISOString();
  const serialized = serialize(entry);
  queue.set(key, serialized);
  persistQueueItem(serialized);
  return serialized;
}

async function deleteQueueItem(cameraId, eventType) {
  const key = makeKey(cameraId, eventType);
  const existed = queue.delete(key);
  let deletedCount = existed ? 1 : 0;
  if (isDatabaseConnected()) {
    const result = await AlertQueueItem.deleteOne({ camera_id: cameraId, event_type: eventType });
    deletedCount = Math.max(deletedCount, result.deletedCount || 0);
  }
  return { deleted: deletedCount > 0 };
}

async function listQueue({ status } = {}) {
  if (isDatabaseConnected()) {
    const filter = status ? { status } : {};
    const items = await AlertQueueItem.find(filter).sort({ updated_at: -1 }).lean();
    items.forEach(cacheEntry);
    return visibleQueueItems(items.map(serialize));
  }

  return visibleQueueItems(Array.from(queue.values()))
    .filter((entry) => !status || entry.status === status)
    .sort((a, b) => {
      const statusRank = { new: 0, in_progress: 1, confirmed: 2, false_alarm: 3, resolved: 4 };
      const rankDiff = statusRank[a.status] - statusRank[b.status];
      if (rankDiff) return rankDiff;
      return new Date(b.last_seen) - new Date(a.last_seen);
    })
    .map(serialize);
}

async function getSummary() {
  const summary = { total: 0, new: 0, in_progress: 0, confirmed: 0, false_alarm: 0, resolved: 0 };

  if (isDatabaseConnected()) {
    const items = await AlertQueueItem.find({}).lean();
    for (const row of visibleQueueItems(items.map(serialize))) {
      const status = normalizeStatus(row.status);
      summary[status] = (summary[status] || 0) + 1;
      summary.total += 1;
    }
    return summary;
  }

  for (const entry of visibleQueueItems(Array.from(queue.values()))) {
    const status = normalizeStatus(entry.status);
    summary.total += 1;
    summary[status] = (summary[status] || 0) + 1;
  }
  return summary;
}

module.exports = {
  VALID_STATUSES,
  deleteQueueItem,
  getSummary,
  listQueue,
  markResolved,
  updateQueueItem,
  upsertFromAlert,
};
