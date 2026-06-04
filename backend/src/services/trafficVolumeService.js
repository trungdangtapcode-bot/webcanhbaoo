/**
 * Traffic Volume Service
 *
 * Tracks vehicle counts per camera using a 15-minute sliding window.
 * Classifies each camera into a traffic level and optionally emits
 * Socket.io events when the level changes.
 *
 * Levels (configurable via env):
 *   NORMAL   — avg vehicle count <  THRESHOLD_MODERATE  (default 5)
 *   MODERATE — avg vehicle count <  THRESHOLD_HIGH      (default 15)
 *   HIGH     — avg vehicle count <  THRESHOLD_CRITICAL  (default 30)
 *   CRITICAL — avg vehicle count >= THRESHOLD_CRITICAL
 */

let ioInstance = null;

function parsePositiveInt(v, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const WINDOW_MS          = parsePositiveInt(process.env.VOLUME_WINDOW_MS,          15 * 60 * 1000);
const THRESHOLD_MODERATE = parsePositiveInt(process.env.VOLUME_THRESHOLD_MODERATE, 5);
const THRESHOLD_HIGH     = parsePositiveInt(process.env.VOLUME_THRESHOLD_HIGH,     15);
const THRESHOLD_CRITICAL = parsePositiveInt(process.env.VOLUME_THRESHOLD_CRITICAL, 30);
// Minimum interval between Socket.io emissions for the same camera (ms)
const EMIT_COOLDOWN_MS   = parsePositiveInt(process.env.VOLUME_EMIT_COOLDOWN_MS,   60 * 1000);
const HEATMAP_STALE_MS   = parsePositiveInt(process.env.VOLUME_HEATMAP_STALE_MS,    2 * 60 * 1000);

const LEVELS = {
  NORMAL:   'NORMAL',
  MODERATE: 'MODERATE',
  HIGH:     'HIGH',
  CRITICAL: 'CRITICAL',
};

const LEVEL_ORDER = [LEVELS.NORMAL, LEVELS.MODERATE, LEVELS.HIGH, LEVELS.CRITICAL];

/**
 * Map<camera_id, {
 *   window       : Array<{ timestamp: number, vehicle_count: number }>,
 *   level        : string,
 *   avgCount     : number,
 *   lat          : number | null,
 *   lng          : number | null,
 *   camera_name  : string,
 *   lastUpdated  : string,   // ISO
 *   _lastEmittedAt: number | null,
 * }>
 */
const cameraVolumes = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function classifyLevel(avg) {
  if (avg >= THRESHOLD_CRITICAL) return LEVELS.CRITICAL;
  if (avg >= THRESHOLD_HIGH)     return LEVELS.HIGH;
  if (avg >= THRESHOLD_MODERATE) return LEVELS.MODERATE;
  return LEVELS.NORMAL;
}

function pruneWindow(window, now) {
  const cutoff = now - WINDOW_MS;
  while (window.length > 0 && window[0].timestamp < cutoff) {
    window.shift();
  }
}

function computeAvg(window) {
  if (window.length === 0) return 0;
  return window.reduce((sum, f) => sum + f.vehicle_count, 0) / window.length;
}

function serializeEntry(entry) {
  const { _lastEmittedAt: _lea, window: _w, ...pub } = entry;
  return pub;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialise with the Socket.io server instance.
 * @param {import('socket.io').Server} io
 */
function init(io) {
  ioInstance = io;
  console.log('[TrafficVolume] Initialized');
}

/**
 * Record a vehicle count observation for a camera.
 *
 * @param {string}  cameraId
 * @param {number}  vehicleCount  - number of vehicles detected in this frame
 * @param {{ lat?: number, lng?: number }} location
 * @param {string}  cameraName
 */
function recordCount(cameraId, vehicleCount, location = {}, cameraName = '') {
  const now = Date.now();

  if (!cameraVolumes.has(cameraId)) {
    cameraVolumes.set(cameraId, {
      window:        [],
      level:         LEVELS.NORMAL,
      avgCount:      0,
      lat:           location.lat ?? null,
      lng:           location.lng ?? null,
      camera_name:   cameraName || cameraId,
      lastUpdated:   new Date(now).toISOString(),
      _lastEmittedAt: null,
    });
  }

  const entry = cameraVolumes.get(cameraId);

  // Update location / name in case they change
  if (location.lat != null) entry.lat = location.lat;
  if (location.lng != null) entry.lng = location.lng;
  if (cameraName)           entry.camera_name = cameraName;

  entry.window.push({ timestamp: now, vehicle_count: Math.max(0, vehicleCount) });
  pruneWindow(entry.window, now);

  const avg      = computeAvg(entry.window);
  const newLevel = classifyLevel(avg);
  const prevLevel = entry.level;

  entry.avgCount    = Math.round(avg * 10) / 10;
  entry.level       = newLevel;
  entry.lastUpdated = new Date(now).toISOString();

  // Emit when level changes OR cooldown elapsed (and level is not NORMAL)
  const levelChanged  = newLevel !== prevLevel;
  const cooldownDone  = !entry._lastEmittedAt || (now - entry._lastEmittedAt) >= EMIT_COOLDOWN_MS;
  const isNoteworthy  = newLevel !== LEVELS.NORMAL;

  if (ioInstance && (levelChanged || (isNoteworthy && cooldownDone))) {
    ioInstance.emit('traffic_volume_update', serializeEntry(entry));
    entry._lastEmittedAt = now;

    if (levelChanged) {
      console.log(
        `[TrafficVolume] ${cameraId}: ${prevLevel} → ${newLevel} (avg ${entry.avgCount} vehicles)`
      );
    }
  }
}

/**
 * Get all cameras with volume data.
 * @param {{ minLevel?: string }} options
 * @returns {object[]}
 */
function getVolumes({ minLevel } = {}) {
  const minRank = minLevel ? LEVEL_ORDER.indexOf(minLevel) : -1;

  return Array.from(cameraVolumes.entries())
    .filter(([, entry]) => {
      if (minRank < 0) return true;
      return LEVEL_ORDER.indexOf(entry.level) >= minRank;
    })
    .map(([camera_id, entry]) => ({
      camera_id,
      ...serializeEntry(entry),
    }))
    .sort((a, b) => b.avgCount - a.avgCount);
}

function getVolume(cameraId) {
  const entry = cameraVolumes.get(cameraId);
  return entry ? serializeEntry(entry) : null;
}

function getHeatmapPoints() {
  const now = Date.now();
  return getVolumes()
    .filter((camera) => camera.lat != null && camera.lng != null)
    .filter((camera) => camera.level !== LEVELS.NORMAL)
    .filter((camera) => {
      const updatedAt = new Date(camera.lastUpdated).getTime();
      return Number.isFinite(updatedAt) && now - updatedAt <= HEATMAP_STALE_MS;
    })
    .map((camera) => {
      const levelWeight = {
        NORMAL: 0.15,
        MODERATE: 0.45,
        HIGH: 0.75,
        CRITICAL: 1,
      }[camera.level] || 0.15;
      const countWeight = Math.min((camera.avgCount || 0) / THRESHOLD_CRITICAL, 1);
      return {
        camera_id: camera.camera_id,
        camera_name: camera.camera_name,
        lat: camera.lat,
        lng: camera.lng,
        intensity: Math.max(levelWeight, countWeight),
        level: camera.level,
        avgCount: camera.avgCount,
        lastUpdated: camera.lastUpdated,
      };
    });
}

/**
 * Get a summary suitable for the dashboard sidebar.
 * Returns counts per level and top N cameras by avg count.
 *
 * @param {number} topN
 */
function getSummary(topN = 5) {
  const all = getVolumes();
  const counts = { NORMAL: 0, MODERATE: 0, HIGH: 0, CRITICAL: 0 };
  for (const item of all) counts[item.level] = (counts[item.level] || 0) + 1;

  return {
    total: all.length,
    counts,
    topCameras: all
      .filter((c) => c.level !== LEVELS.NORMAL)
      .slice(0, topN),
  };
}

module.exports = {
  init,
  recordCount,
  getVolumes,
  getVolume,
  getHeatmapPoints,
  getSummary,
  LEVELS,
};
