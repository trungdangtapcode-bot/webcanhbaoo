/**
 * Traffic Jam Detection — Sliding Window (120s)
 *
 * In-memory Map per camera_id stores timestamped frames.
 *
 * Jam detection criteria (all must be true):
 *   1. avg_speed < JAM_SPEED_THRESHOLD (px/frame) across the window
 *   2. avg_vehicle_count > JAM_VEHICLE_THRESHOLD
 *   3. At least JAM_FRAME_RATIO of frames in the window satisfy the jam condition
 *      (replaces the old "consecutive break" logic that a single noisy frame
 *       could reset — now uses percentage to tolerate occasional outliers)
 *   4. Sustained for at least camera.max_red_light_time seconds
 */

// Map<camera_id, Array<{ timestamp, avg_speed, vehicle_count }>>
const slidingWindows = new Map();

const WINDOW_DURATION_MS = 120 * 1000; // 120 seconds

// Jam thresholds (can be overridden via env at startup)
const JAM_SPEED_THRESHOLD   = Number(process.env.JAM_SPEED_THRESHOLD   ?? 5);
const JAM_VEHICLE_THRESHOLD = Number(process.env.JAM_VEHICLE_THRESHOLD ?? 20);
// Fraction of frames in the window that must satisfy jam condition (0–1)
const JAM_FRAME_RATIO       = Number(process.env.JAM_FRAME_RATIO       ?? 0.6);

/**
 * Push a frame into the sliding window and evaluate jam status.
 *
 * @param {string} cameraId
 * @param {object} data - { avg_speed, vehicle_count, timestamp }
 * @param {number} maxRedLightTime - camera-specific threshold in seconds (default 90)
 * @returns {{ isJam: boolean, severity: string, duration: number, jamFrameRatio: number }}
 */
function evaluate(cameraId, data, maxRedLightTime = 90) {
  const now = data.timestamp ? new Date(data.timestamp).getTime() : Date.now();

  if (!slidingWindows.has(cameraId)) {
    slidingWindows.set(cameraId, []);
  }

  const window = slidingWindows.get(cameraId);

  // Add current frame
  window.push({
    timestamp: now,
    avg_speed: data.avg_speed ?? 0,
    vehicle_count: data.vehicle_count ?? 0,
  });

  // Prune frames older than WINDOW_DURATION_MS
  const cutoff = now - WINDOW_DURATION_MS;
  while (window.length > 0 && window[0].timestamp < cutoff) {
    window.shift();
  }

  if (window.length === 0) {
    return { isJam: false, severity: 'low', duration: 0, jamFrameRatio: 0 };
  }

  // ── Window-wide averages ────────────────────────────────────────────────
  const avgSpeed    = window.reduce((sum, f) => sum + f.avg_speed,    0) / window.length;
  const avgVehicles = window.reduce((sum, f) => sum + f.vehicle_count, 0) / window.length;

  // ── Percentage of frames satisfying jam condition ──────────────────────
  // Uses threshold-based counting instead of consecutive break, so a single
  // noisy "clear" frame cannot reset the entire jam state.
  const jamFrames = window.filter(
    (f) => f.avg_speed < JAM_SPEED_THRESHOLD && f.vehicle_count > JAM_VEHICLE_THRESHOLD,
  ).length;
  const jamFrameRatio = jamFrames / window.length;

  // ── How long the jam has been sustained ────────────────────────────────
  // Walk backwards from the latest frame and find the earliest timestamp
  // that belongs to a continuous run of jam-condition frames (≥60% frames
  // in any rolling sub-window count as jam).  Use the oldest such timestamp.
  let sustainedStartIdx = window.length - 1;
  for (let i = window.length - 1; i >= 0; i--) {
    const subWindow = window.slice(i);
    const subJamFrames = subWindow.filter(
      (f) => f.avg_speed < JAM_SPEED_THRESHOLD && f.vehicle_count > JAM_VEHICLE_THRESHOLD,
    ).length;
    if (subJamFrames / subWindow.length >= JAM_FRAME_RATIO) {
      sustainedStartIdx = i;
    } else {
      break;
    }
  }

  const durationSec = (now - window[sustainedStartIdx].timestamp) / 1000;

  const isJam =
    avgSpeed    < JAM_SPEED_THRESHOLD   &&
    avgVehicles > JAM_VEHICLE_THRESHOLD &&
    jamFrameRatio >= JAM_FRAME_RATIO    &&
    durationSec >= maxRedLightTime;

  let severity = 'low';
  if (isJam) {
    if (durationSec >= maxRedLightTime * 2)   severity = 'critical';
    else if (durationSec >= maxRedLightTime * 1.5) severity = 'high';
    else severity = 'medium';
  }

  return { isJam, severity, duration: Math.round(durationSec), jamFrameRatio: Math.round(jamFrameRatio * 100) / 100 };
}

/**
 * Clear the sliding window for a camera (e.g., on camera reset).
 */
function clearWindow(cameraId) {
  slidingWindows.delete(cameraId);
}

module.exports = { evaluate, clearWindow };
