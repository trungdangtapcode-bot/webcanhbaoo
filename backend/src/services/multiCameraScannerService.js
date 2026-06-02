const Event = require('../models/Event');
const Camera = require('../models/Camera');
const { isDatabaseConnected } = require('../config/database');
const alertService = require('./alertService');
const { getCachedHealth } = require('./cameraHealthService');
const { getPersistedEventImage } = require('./eventImagePolicy');
const floodService = require('./floodService');
const trafficVolumeService = require('./trafficVolumeService');
const { fetchSnapshot, getHcmCameras } = require('./hcmCameraService');
const { getHanoiCameras } = require('./hanoiCameraService');

const VALID_EVENT_TYPES = new Set(['traffic_jam', 'traffic_volume', 'fire', 'flood']);
const HANOI_MJPEG_PROXY_BASE_URL =
  process.env.HANOI_MJPEG_PROXY_BASE_URL || 'http://127.0.0.1:5001';
const HANOI_SNAPSHOT_TIMEOUT_MS = parsePositiveInt(process.env.HANOI_SNAPSHOT_TIMEOUT_MS, 18000);

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveFloat(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const defaults = {
  cameraLimit: parsePositiveInt(process.env.SCANNER_CAMERA_LIMIT, 12),
  concurrency: parsePositiveInt(process.env.SCANNER_CONCURRENCY, 4),
  detectorUrl: process.env.AI_DETECTOR_URL || '',
  intervalMs: parsePositiveInt(process.env.SCANNER_INTERVAL_MS, 10000),
  minConfidence: parsePositiveFloat(process.env.SCANNER_MIN_CONFIDENCE, 0.6),
  mockDetections: process.env.SCANNER_MOCK_DETECTIONS === 'true',
  source: process.env.SCANNER_CAMERA_SOURCE || 'hcm',
};

const state = {
  activeWorkers: 0,
  config: { ...defaults },
  cursor: 0,
  lastStrategy: null,
  lastRun: null,
  queueLength: 0,
  running: false,
  scanning: false,
  startedAt: null,
  timer: null,
};

function publicConfig() {
  return {
    cameraLimit: state.config.cameraLimit,
    concurrency: state.config.concurrency,
    detectorConfigured: Boolean(state.config.detectorUrl),
    intervalMs: state.config.intervalMs,
    minConfidence: state.config.minConfidence,
    mockDetections: state.config.mockDetections,
    source: state.config.source,
    strategy: 'priority_round_robin',
  };
}

function getStatus() {
  return {
    activeWorkers: state.activeWorkers,
    config: publicConfig(),
    lastRun: state.lastRun,
    lastStrategy: state.lastStrategy,
    queueLength: state.queueLength,
    running: state.running,
    scanning: state.scanning,
    startedAt: state.startedAt,
  };
}

function normalizeStartOptions(options = {}) {
  return {
    cameraLimit: parsePositiveInt(options.cameraLimit, state.config.cameraLimit),
    concurrency: parsePositiveInt(options.concurrency, state.config.concurrency),
    detectorUrl: typeof options.detectorUrl === 'string' ? options.detectorUrl : state.config.detectorUrl,
    intervalMs: parsePositiveInt(options.intervalMs, state.config.intervalMs),
    minConfidence: parsePositiveFloat(options.minConfidence, state.config.minConfidence),
    mockDetections:
      typeof options.mockDetections === 'boolean' ? options.mockDetections : state.config.mockDetections,
    source: typeof options.source === 'string' && options.source.trim() ? options.source.trim() : state.config.source,
  };
}

function isRushHour(date = new Date()) {
  const hour = date.getHours();
  return (hour >= 6 && hour <= 9) || (hour >= 16 && hour <= 19);
}

function isCentralCamera(camera) {
  const lat = Number(camera.location?.lat);
  const lng = Number(camera.location?.lng);
  if (camera.source === 'hanoi_video_wall') {
    return lat >= 21.0 && lat <= 21.06 && lng >= 105.78 && lng <= 105.87;
  }
  return lat >= 10.74 && lat <= 10.82 && lng >= 106.66 && lng <= 106.73;
}

function levelScore(level) {
  return { MODERATE: 15, HIGH: 35, CRITICAL: 55 }[level] || 0;
}

function scoreCamera(camera, activeCameraIds, total, index) {
  const health = getCachedHealth(camera.camera_id);
  const volume = trafficVolumeService.getVolume(camera.camera_id);
  const roundRobinDistance = (index - state.cursor + total) % total;
  let score = Math.max(total - roundRobinDistance, 0) / Math.max(total, 1);
  const reasons = ['round_robin'];

  if (activeCameraIds.has(camera.camera_id)) {
    score += 100;
    reasons.push('active_alert');
  }
  if (volume) {
    const trafficScore = levelScore(volume.level) + Math.min(Number(volume.avgCount) || 0, 30);
    if (trafficScore > 0) {
      score += trafficScore;
      reasons.push('traffic_volume');
    }
  }
  if (isCentralCamera(camera)) {
    score += isRushHour() ? 22 : 10;
    reasons.push(isRushHour() ? 'central_rush_hour' : 'central_area');
  }
  if (!health) {
    score += 8;
    reasons.push('unchecked_health');
  } else if (['timeout', 'error'].includes(health.status)) {
    score -= 35;
    reasons.push('recent_health_issue');
  } else if (['black', 'stale'].includes(health.status)) {
    score -= 12;
    reasons.push('frame_quality_issue');
  }

  return { score, reasons };
}

function selectPriorityBatch(cameras, limit) {
  if (!cameras.length) return [];
  const total = cameras.length;
  const activeCameraIds = new Set(alertService.getActiveAlerts().map((alert) => alert.camera_id));
  const ranked = cameras
    .map((camera, index) => {
      const scored = scoreCamera(camera, activeCameraIds, total, index);
      return {
        camera,
        index,
        reasons: scored.reasons,
        score: Math.round(scored.score * 100) / 100,
      };
    })
    .sort((a, b) => b.score - a.score || ((a.index - state.cursor + total) % total) - ((b.index - state.cursor + total) % total));

  const selected = ranked.slice(0, Math.min(limit, ranked.length));
  const lastSelected = selected[selected.length - 1];
  state.cursor = lastSelected ? (lastSelected.index + 1) % total : state.cursor;
  state.lastStrategy = {
    cursor: state.cursor,
    selected: selected.length,
    total,
    top: selected.slice(0, 5).map((item) => ({
      camera_id: item.camera.camera_id,
      reasons: item.reasons,
      score: item.score,
    })),
    updatedAt: new Date().toISOString(),
  };

  return selected.map((item) => item.camera);
}

async function getAllSourceCameras() {
  if (state.config.source === 'hcm') {
    return getHcmCameras();
  }

  if (state.config.source === 'hanoi') {
    return getHanoiCameras();
  }

  if (state.config.source === 'all') {
    return [...getHcmCameras(), ...(await getHanoiCameras())];
  }

  if (isDatabaseConnected()) {
    return Camera.find({ active: { $ne: false } })
      .select('-token_hash')
      .sort({ camera_id: 1 })
      .lean();
  }

  return getHcmCameras();
}

async function getCameraBatch() {
  const cameras = await getAllSourceCameras();
  return selectPriorityBatch(cameras, state.config.cameraLimit);
}

async function fetchBufferWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Frame request failed with ${response.status}`);
    }
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') || 'image/jpeg',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHanoiFrame(camera) {
  const proxyBase = HANOI_MJPEG_PROXY_BASE_URL.replace(/\/$/, '');
  const url =
    `${proxyBase}/hanoi_snapshot/${encodeURIComponent(camera.camera_id)}?timeout=${Math.ceil(HANOI_SNAPSHOT_TIMEOUT_MS / 1000)}`;
  const frame = await fetchBufferWithTimeout(url, HANOI_SNAPSHOT_TIMEOUT_MS + 3000);
  return {
    ...frame,
    metadata: {
      frame_source: 'hanoi_wss_proxy_snapshot',
      proxy_base: proxyBase,
    },
  };
}

async function fetchCameraFrame(camera) {
  if (camera.source === 'hanoi_video_wall' || camera.stream_type === 'wss_video') {
    return fetchHanoiFrame(camera);
  }

  if (camera.source === 'hcm_traffic_portal' || camera.external_id) {
    return fetchSnapshot(camera.external_id || camera.camera_id);
  }

  const url = camera.snapshot_url || camera.stream_url;
  if (!url) {
    throw new Error('Camera has no snapshot_url or stream_url');
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Frame request failed with ${response.status}`);
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || 'image/jpeg',
  };
}

function normalizeDetections(payload) {
  const raw = Array.isArray(payload?.detections)
    ? payload.detections
    : Array.isArray(payload?.events)
      ? payload.events
      : payload?.event_type
        ? [payload]
        : [];

  return raw
    .map((item) => ({
      active: item.active !== false && item.clear !== true,
      avg_speed: item.avg_speed,
      confidence: Number(item.confidence),
      event_type: item.event_type,
      metadata: item.metadata || {},
      severity: item.severity,
      vehicle_count: item.vehicle_count,
      water_ratio: item.water_ratio,
    }))
    .filter((item) => VALID_EVENT_TYPES.has(item.event_type))
    .filter((item) => !item.active || Number.isFinite(item.confidence))
    .filter((item) => !item.active || item.confidence >= state.config.minConfidence);
}

async function detectFrame(camera, frame, tickId) {
  if (state.config.detectorUrl) {
    const response = await fetch(state.config.detectorUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        camera: {
          camera_id: camera.camera_id,
          external_id: camera.external_id,
          location: camera.location,
          name: camera.name,
          source: camera.source,
        },
        content_type: frame.contentType,
        image_base64: frame.buffer.toString('base64'),
        metadata: frame.metadata || {},
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Detector failed with ${response.status}`);
    }

    return normalizeDetections(await response.json());
  }

  if (!state.config.mockDetections) {
    return [];
  }

  // Demo-only: deterministic occasional traffic signal to verify the whole realtime path.
  const shouldEmit = tickId % 6 === 0 && camera.camera_id.endsWith('31c');
  return shouldEmit
    ? [{
      active: true,
      confidence: 0.82,
      event_type: 'traffic_jam',
      metadata: { detector: 'mock', note: 'Demo detection generated by scanner' },
      severity: 'medium',
      vehicle_count: 8,
      avg_speed: 2,
    }]
    : [];
}

async function publishDetection(camera, detection, frame) {
  const timestamp = new Date();
  const metadata = {
    ...(detection.metadata || {}),
    active: detection.active,
    detector_url_configured: Boolean(state.config.detectorUrl),
    scanner: {
      concurrency: state.config.concurrency,
      source: state.config.source,
    },
  };

  if (!detection.active) {
    const clearResult = alertService.clearAlert(camera.camera_id, detection.event_type, {
      reason: 'scanner_clear',
      timestamp,
      metadata,
    });
    return { cleared: clearResult.cleared };
  }

  const imageBase64 = frame.buffer.toString('base64');
  let eventId = null;

  if (isDatabaseConnected()) {
    try {
      const persistedImage = getPersistedEventImage(imageBase64, {
        active: detection.active,
        event_type: detection.event_type,
        severity: detection.severity || 'medium',
      });
      const event = await Event.create({
        camera_id: camera.camera_id,
        confidence: detection.confidence,
        event_type: detection.event_type,
        image_base64: persistedImage,
        metadata: {
          ...metadata,
          avg_speed: detection.avg_speed,
          vehicle_count: detection.vehicle_count,
          water_ratio: detection.water_ratio,
        },
        severity: detection.severity || 'medium',
        timestamp,
      });
      eventId = event._id;
    } catch (err) {
      console.error('[Scanner] Event persistence failed:', err.message);
    }
  }

  const activeResult = alertService.upsertActiveAlert({
    camera_id: camera.camera_id,
    camera_name: camera.name,
    confidence: detection.confidence,
    event_type: detection.event_type,
    image_base64: imageBase64,
    lat: camera.location?.lat,
    lng: camera.location?.lng,
    metadata,
    severity: detection.severity || 'medium',
    timestamp,
  });

  return {
    alert_created: activeResult.created,
    event_id: eventId,
  };
}

async function processCamera(camera, tickId) {
  const startedAt = Date.now();
  const frame = await fetchCameraFrame(camera);
  const detections = await detectFrame(camera, frame, tickId);
  const published = [];

  for (const detection of detections) {
    // traffic_volume events are informational — only create alerts for incidents
    if (detection.event_type === 'traffic_volume') {
      continue;
    }
    if (detection.event_type === 'flood') {
      const ratio = Number(detection.water_ratio ?? detection.metadata?.water_ratio ?? 0);
      const result = floodService.evaluate(camera.camera_id, Number.isFinite(ratio) ? ratio : 0);
      const active = result.state === floodService.STATES.ALERT;
      detection.active = active;
      detection.severity = result.severity;
      detection.metadata = {
        ...(detection.metadata || {}),
        flood_state: result.state,
        flood_prev_state: result.prevState,
        flood_alert_frames: result.alertFrames,
        flood_thresholds: result.thresholds,
        water_ratio: Number.isFinite(ratio) ? ratio : 0,
      };

      if (!active && result.prevState !== floodService.STATES.ALERT) {
        continue;
      }
    }
    published.push(await publishDetection(camera, detection, frame));
  }

  // Record vehicle count for traffic volume tracking.
  // Use the traffic_jam detection vehicle_count if present, otherwise 0.
  const trafficDetection = detections.find((d) => d.event_type === 'traffic_jam' || d.event_type === 'traffic_volume');
  const vehicleCount = trafficDetection?.vehicle_count ?? 0;
  trafficVolumeService.recordCount(
    camera.camera_id,
    vehicleCount,
    { lat: camera.location?.lat, lng: camera.location?.lng },
    camera.name,
  );

  return {
    camera_id: camera.camera_id,
    detections: detections.length,
    durationMs: Date.now() - startedAt,
    published,
  };
}

async function runPool(cameras, tickId) {
  let cursor = 0;
  const results = [];
  const failures = [];
  const workerCount = Math.min(state.config.concurrency, cameras.length);

  async function worker(workerId) {
    while (cursor < cameras.length) {
      const camera = cameras[cursor];
      cursor += 1;
      state.activeWorkers += 1;
      state.queueLength = Math.max(cameras.length - cursor, 0);
      try {
        results.push(await processCamera(camera, tickId));
      } catch (err) {
        failures.push({
          camera_id: camera.camera_id,
          error: err.message,
          workerId,
        });
      } finally {
        state.activeWorkers -= 1;
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, (_item, index) => worker(index + 1)));
  return { failures, results };
}

async function scanOnce() {
  if (state.scanning) {
    return {
      skipped: true,
      reason: 'scan_already_running',
      status: getStatus(),
    };
  }

  state.scanning = true;
  const startedAt = Date.now();
  const tickId = startedAt;
  const cameras = await getCameraBatch();
  state.queueLength = cameras.length;

  try {
    const { failures, results } = await runPool(cameras, tickId);
    const detections = results.reduce((sum, item) => sum + item.detections, 0);
    state.lastRun = {
      cameras: cameras.length,
      detections,
      durationMs: Date.now() - startedAt,
      failed: failures.length,
      finishedAt: new Date().toISOString(),
      processed: results.length,
      startedAt: new Date(startedAt).toISOString(),
    };

    return {
      failures,
      results,
      summary: state.lastRun,
    };
  } finally {
    state.activeWorkers = 0;
    state.queueLength = 0;
    state.scanning = false;
  }
}

function scheduleNextRun() {
  if (!state.running) return;
  state.timer = setTimeout(async () => {
    try {
      await scanOnce();
    } catch (err) {
      state.lastRun = {
        error: err.message,
        failed: true,
        finishedAt: new Date().toISOString(),
      };
      console.error('[Scanner] scan failed:', err);
    } finally {
      scheduleNextRun();
    }
  }, state.config.intervalMs);

  if (typeof state.timer.unref === 'function') state.timer.unref();
}

async function start(options = {}) {
  state.config = normalizeStartOptions(options);
  if (state.running) return getStatus();

  state.running = true;
  state.startedAt = new Date().toISOString();
  console.log(
    `[Scanner] started: source=${state.config.source}, concurrency=${state.config.concurrency}, interval=${state.config.intervalMs}ms`
  );

  scanOnce()
    .catch((err) => {
      state.lastRun = {
        error: err.message,
        failed: true,
        finishedAt: new Date().toISOString(),
      };
      console.error('[Scanner] initial scan failed:', err);
    })
    .finally(scheduleNextRun);

  return getStatus();
}

function stop() {
  state.running = false;
  state.startedAt = null;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  console.log('[Scanner] stopped');
  return getStatus();
}

module.exports = {
  getStatus,
  scanOnce,
  start,
  stop,
};
