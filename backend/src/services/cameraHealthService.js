const crypto = require('crypto');
const { fetchSnapshot, getHcmCameras } = require('./hcmCameraService');

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = Number(process.env.CAMERA_HEALTH_MAX_LIMIT || 200);
const DEFAULT_CONCURRENCY = Number(process.env.CAMERA_HEALTH_CONCURRENCY || 6);

const healthCache = new Map();

function parsePositiveInt(value, fallback) {
  if (value === 'all') return Number.POSITIVE_INFINITY;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getRequestedCameras({ cameraIds, limit, offset } = {}, maxLimit = MAX_LIMIT) {
  const allCameras = getHcmCameras();
  if (Array.isArray(cameraIds) && cameraIds.length) {
    const wanted = new Set(cameraIds.map(String));
    return allCameras.filter((camera) => wanted.has(camera.camera_id) || wanted.has(camera.external_id));
  }

  const safeOffset = Math.max(0, parsePositiveInt(offset, 0));
  const requestedLimit = parsePositiveInt(limit, DEFAULT_LIMIT);
  const safeLimit = Math.min(requestedLimit, maxLimit);
  return allCameras.slice(safeOffset, safeOffset + safeLimit);
}

function normalizeStatus(camera, cached) {
  return {
    camera_id: camera.camera_id,
    external_id: camera.external_id,
    name: camera.name,
    status: cached?.status || 'unchecked',
    issue_type: cached?.issue_type || null,
    checked_at: cached?.checked_at || null,
    previous_checked_at: cached?.previous_checked_at || null,
    response_ms: cached?.response_ms || null,
    content_type: cached?.content_type || null,
    bytes: cached?.bytes || 0,
    hash: cached?.hash || null,
    error: cached?.error || null,
  };
}

function getCameraHealth(options = {}) {
  const cameras = getRequestedCameras(options, getHcmCameras().length);
  return cameras.map((camera) => normalizeStatus(camera, healthCache.get(camera.camera_id)));
}

function getHealthSummary() {
  const cameras = getHcmCameras();
  const summary = {
    total: cameras.length,
    black: 0,
    error: 0,
    live: 0,
    offline: 0,
    issues: 0,
    stale: 0,
    timeout: 0,
    unchecked: 0,
    checked: 0,
  };

  cameras.forEach((camera) => {
    const status = healthCache.get(camera.camera_id)?.status || 'unchecked';
    if (status === 'live') summary.live += 1;
    else if (status === 'timeout') summary.timeout += 1;
    else if (status === 'black') summary.black += 1;
    else if (status === 'stale') summary.stale += 1;
    else if (status === 'offline') summary.offline += 1;
    else if (status === 'error') summary.error += 1;
    else summary.unchecked += 1;
  });
  summary.issues = summary.timeout + summary.black + summary.stale + summary.offline + summary.error;
  summary.checked = summary.live + summary.issues;
  return summary;
}

function byteEntropy(buffer, sampleSize = 8192) {
  const length = Math.min(buffer.length, sampleSize);
  if (!length) return 0;

  const counts = new Array(256).fill(0);
  for (let index = 0; index < length; index += 1) {
    counts[buffer[index]] += 1;
  }

  return counts.reduce((sum, count) => {
    if (!count) return sum;
    const probability = count / length;
    return sum - probability * Math.log2(probability);
  }, 0);
}

function classifyError(err) {
  const message = String(err?.message || '');
  if (err?.name === 'AbortError' || /abort|timeout|timed out/i.test(message)) {
    return 'timeout';
  }
  if (err?.issueType === 'unavailable_placeholder' || /IMAGE NOT AVAILABLE|placeholder/i.test(message)) {
    return 'offline';
  }
  return 'error';
}

function analyzeSnapshot(camera, snapshot, previous) {
  const hash = crypto.createHash('sha1').update(snapshot.buffer).digest('hex');
  const entropy = byteEntropy(snapshot.buffer);
  const isImage = /^image\//i.test(snapshot.contentType || '');
  const isTooSmall = snapshot.buffer.length < 1024;
  const lowEntropy = entropy > 0 && entropy < 1.1;
  const status = isTooSmall || !isImage || lowEntropy
    ? 'black'
    : previous?.hash === hash
      ? 'stale'
      : 'live';

  return {
    status,
    issue_type: status === 'live' ? null : status,
    checked_at: new Date().toISOString(),
    previous_checked_at: previous?.checked_at || null,
    content_type: snapshot.contentType,
    bytes: snapshot.buffer.length,
    hash,
    entropy: Math.round(entropy * 100) / 100,
    error: status === 'black'
      ? `Suspicious frame for ${camera.camera_id}: ${snapshot.buffer.length} bytes, entropy ${entropy.toFixed(2)}`
      : null,
  };
}

async function checkOneCamera(camera) {
  const startedAt = Date.now();
  const previous = healthCache.get(camera.camera_id);
  try {
    const snapshot = await fetchSnapshot(camera.camera_id);
    const result = {
      ...analyzeSnapshot(camera, snapshot, previous),
      response_ms: Date.now() - startedAt,
    };
    healthCache.set(camera.camera_id, result);
    return normalizeStatus(camera, result);
  } catch (err) {
    const status = classifyError(err);
    const result = {
      status,
      issue_type: status,
      checked_at: new Date().toISOString(),
      previous_checked_at: previous?.checked_at || null,
      response_ms: Date.now() - startedAt,
      content_type: null,
      bytes: 0,
      error: err.message,
    };
    healthCache.set(camera.camera_id, result);
    return normalizeStatus(camera, result);
  }
}

async function checkCameraHealth(options = {}) {
  const cameras = getRequestedCameras(options);
  const concurrency = Math.max(1, Math.min(parsePositiveInt(options.concurrency, DEFAULT_CONCURRENCY), 12));
  const results = [];
  let cursor = 0;

  async function worker() {
    while (cursor < cameras.length) {
      const camera = cameras[cursor];
      cursor += 1;
      results.push(await checkOneCamera(camera));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, cameras.length) }, worker));
  return {
    checked: results.length,
    results,
    summary: getHealthSummary(),
  };
}

function getCachedHealth(cameraId) {
  return healthCache.get(cameraId) || null;
}

module.exports = {
  checkCameraHealth,
  getCameraHealth,
  getCachedHealth,
  getHealthSummary,
};
