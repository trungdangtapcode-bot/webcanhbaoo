const VALID_STATUSES = new Set(['new', 'in_progress', 'confirmed', 'false_alarm', 'resolved']);

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
    first_seen: entry.first_seen,
    last_seen: entry.last_seen,
    updated_at: entry.updated_at,
    assignee: entry.assignee,
    note: entry.note,
    metadata: entry.metadata || {},
  };
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

  queue.set(key, entry);
  return serialize(entry);
}

function markResolved(cameraId, eventType, metadata = {}) {
  const key = makeKey(cameraId, eventType);
  const entry = queue.get(key);
  if (!entry) return null;

  entry.status = 'resolved';
  entry.updated_at = new Date().toISOString();
  entry.metadata = { ...(entry.metadata || {}), ...metadata };
  return serialize(entry);
}

function updateQueueItem(cameraId, eventType, updates = {}) {
  const key = makeKey(cameraId, eventType);
  const entry = queue.get(key);
  if (!entry) return null;

  entry.status = normalizeStatus(updates.status, entry.status);
  if (updates.assignee !== undefined) entry.assignee = String(updates.assignee || '').slice(0, 80) || null;
  if (updates.note !== undefined) entry.note = String(updates.note || '').slice(0, 500);
  entry.updated_at = new Date().toISOString();
  return serialize(entry);
}

function listQueue({ status } = {}) {
  return Array.from(queue.values())
    .filter((entry) => !status || entry.status === status)
    .sort((a, b) => {
      const statusRank = { new: 0, in_progress: 1, confirmed: 2, false_alarm: 3, resolved: 4 };
      const rankDiff = statusRank[a.status] - statusRank[b.status];
      if (rankDiff) return rankDiff;
      return new Date(b.last_seen) - new Date(a.last_seen);
    })
    .map(serialize);
}

function getSummary() {
  const summary = { total: 0, new: 0, in_progress: 0, confirmed: 0, false_alarm: 0, resolved: 0 };
  for (const entry of queue.values()) {
    summary.total += 1;
    summary[entry.status] = (summary[entry.status] || 0) + 1;
  }
  return summary;
}

module.exports = {
  VALID_STATUSES,
  getSummary,
  listQueue,
  markResolved,
  updateQueueItem,
  upsertFromAlert,
};
