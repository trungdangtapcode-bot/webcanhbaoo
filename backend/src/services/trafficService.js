/**
 * Traffic Jam Detection — Sliding Window (120s)
 *
 * In-memory Map per camera_id stores timestamped frames.
 * Jam detected when avg_speed < 5 px/frame AND vehicle_count > 3
 * sustained longer than camera.max_red_light_time (default 90s).
 */

// Map<camera_id, Array<{ timestamp, avg_speed, vehicle_count }>>
const slidingWindows = new Map();

const WINDOW_DURATION_MS = 120 * 1000; // 120 seconds

/**
 * Push a frame into the sliding window and evaluate jam status.
 *
 * @param {string} cameraId
 * @param {object} data - { avg_speed, vehicle_count, timestamp }
 * @param {number} maxRedLightTime - camera-specific threshold in seconds (default 90)
 * @returns {{ isJam: boolean, severity: string, duration: number }}
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
    avg_speed: data.avg_speed || 0,
    vehicle_count: data.vehicle_count || 0,
  });

  // Prune frames older than WINDOW_DURATION_MS
  const cutoff = now - WINDOW_DURATION_MS;
  while (window.length > 0 && window[0].timestamp < cutoff) {
    window.shift();
  }

  if (window.length === 0) {
    return { isJam: false, severity: 'low', duration: 0 };
  }

  // Calculate averages over the window
  const avgSpeed =
    window.reduce((sum, f) => sum + f.avg_speed, 0) / window.length;
  const avgVehicles =
    window.reduce((sum, f) => sum + f.vehicle_count, 0) / window.length;

  // Find how long the jam condition has been sustained (consecutive from latest)
  let sustainedStart = now;
  for (let i = window.length - 1; i >= 0; i--) {
    if (window[i].avg_speed < 5 && window[i].vehicle_count > 3) {
      sustainedStart = window[i].timestamp;
    } else {
      break;
    }
  }

  const durationSec = (now - sustainedStart) / 1000;
  const isJam = avgSpeed < 5 && avgVehicles > 3 && durationSec >= maxRedLightTime;

  let severity = 'low';
  if (isJam) {
    if (durationSec >= maxRedLightTime * 2) severity = 'critical';
    else if (durationSec >= maxRedLightTime * 1.5) severity = 'high';
    else severity = 'medium';
  }

  return { isJam, severity, duration: Math.round(durationSec) };
}

/**
 * Clear the sliding window for a camera (e.g., on camera reset).
 */
function clearWindow(cameraId) {
  slidingWindows.delete(cameraId);
}

module.exports = { evaluate, clearWindow };
