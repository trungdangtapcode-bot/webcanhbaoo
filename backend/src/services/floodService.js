/**
 * Flood Detection — State Machine
 *
 * States: NORMAL → WATCH → ALERT
 * Transitions:
 *   NORMAL → WATCH  when water_ratio >= 0.15
 *   WATCH  → ALERT  when water_ratio >= 0.30
 *   ALERT  → WATCH  when water_ratio <  0.30
 *   WATCH  → NORMAL when water_ratio <  0.15
 *
 * Alerts emitted only on upward transitions (NORMAL→WATCH, WATCH→ALERT).
 */

const STATES = {
  NORMAL: 'NORMAL',
  WATCH: 'WATCH',
  ALERT: 'ALERT',
};

const THRESHOLDS = {
  WATCH: 0.15,
  ALERT: 0.30,
};

// Map<camera_id, { state, lastRatio, updatedAt }>
const floodStates = new Map();

/**
 * Evaluate a flood frame and determine if an alert transition occurred.
 *
 * @param {string} cameraId
 * @param {number} waterRatio - 0.0 to 1.0
 * @returns {{ shouldAlert: boolean, state: string, prevState: string, severity: string }}
 */
function evaluate(cameraId, waterRatio) {
  if (!floodStates.has(cameraId)) {
    floodStates.set(cameraId, {
      state: STATES.NORMAL,
      lastRatio: 0,
      updatedAt: Date.now(),
    });
  }

  const entry = floodStates.get(cameraId);
  const prevState = entry.state;
  let newState = prevState;

  if (waterRatio >= THRESHOLDS.ALERT) {
    newState = STATES.ALERT;
  } else if (waterRatio >= THRESHOLDS.WATCH) {
    newState = STATES.WATCH;
  } else {
    newState = STATES.NORMAL;
  }

  entry.state = newState;
  entry.lastRatio = waterRatio;
  entry.updatedAt = Date.now();

  // Only emit alert on UPWARD transitions
  const shouldAlert =
    (prevState === STATES.NORMAL && newState === STATES.WATCH) ||
    (prevState === STATES.WATCH && newState === STATES.ALERT) ||
    (prevState === STATES.NORMAL && newState === STATES.ALERT);

  let severity = 'low';
  if (newState === STATES.ALERT) severity = 'high';
  else if (newState === STATES.WATCH) severity = 'medium';

  return { shouldAlert, state: newState, prevState, severity };
}

/**
 * Get the current flood state for a camera.
 */
function getState(cameraId) {
  return floodStates.get(cameraId) || { state: STATES.NORMAL, lastRatio: 0 };
}

/**
 * Reset a camera's flood state.
 */
function resetState(cameraId) {
  floodStates.delete(cameraId);
}

module.exports = { evaluate, getState, resetState, STATES };
