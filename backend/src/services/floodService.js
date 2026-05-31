/**
 * Flood Detection — State Machine with Hysteresis
 *
 * States: NORMAL → WATCH → ALERT
 *
 * Upward transitions (strict thresholds):
 *   NORMAL → WATCH  when water_ratio >= 0.15
 *   WATCH  → ALERT  when water_ratio >= 0.30
 *
 * Downward transitions use LOWER hysteresis thresholds to avoid oscillation:
 *   ALERT  → WATCH  when water_ratio <  0.22  (not 0.30)
 *   WATCH  → NORMAL when water_ratio <  0.10  (not 0.15)
 *
 * Alerts emitted only on upward transitions (NORMAL→WATCH, WATCH→ALERT).
 *
 * WATCH confirmation: requires WATCH_CONFIRM_FRAMES consecutive WATCH readings
 * before escalating to ALERT (prevents brief puddle reflections from alerting).
 */

const STATES = {
  NORMAL: 'NORMAL',
  WATCH: 'WATCH',
  ALERT: 'ALERT',
};

// Up-thresholds (trigger escalation)
const UP_THRESHOLDS = {
  WATCH: 0.15,
  ALERT: 0.30,
};

// Down-thresholds (trigger de-escalation) — lower than up-thresholds (hysteresis)
const DOWN_THRESHOLDS = {
  WATCH_TO_NORMAL: 0.10,
  ALERT_TO_WATCH:  0.22,
};

// Require this many consecutive WATCH frames before escalating to ALERT
const WATCH_CONFIRM_FRAMES = 3;

// Map<camera_id, { state, lastRatio, updatedAt, watchFrames }>
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
      watchFrames: 0,
    });
  }

  const entry = floodStates.get(cameraId);
  const prevState = entry.state;
  let newState = prevState;

  // ── Compute next state with hysteresis ──────────────────────────────────
  if (prevState === STATES.NORMAL) {
    // Only escalate upward on strict up-threshold
    if (waterRatio >= UP_THRESHOLDS.ALERT) {
      newState = STATES.ALERT;
    } else if (waterRatio >= UP_THRESHOLDS.WATCH) {
      newState = STATES.WATCH;
    }
  } else if (prevState === STATES.WATCH) {
    if (waterRatio >= UP_THRESHOLDS.ALERT) {
      // Only escalate to ALERT after enough consecutive WATCH frames
      entry.watchFrames += 1;
      if (entry.watchFrames >= WATCH_CONFIRM_FRAMES) {
        newState = STATES.ALERT;
      }
      // else: stay WATCH until confirmed
    } else if (waterRatio < DOWN_THRESHOLDS.WATCH_TO_NORMAL) {
      // De-escalate below hysteresis threshold
      newState = STATES.NORMAL;
      entry.watchFrames = 0;
    } else {
      // Still in WATCH range — stay WATCH
      entry.watchFrames = 0;
    }
  } else if (prevState === STATES.ALERT) {
    if (waterRatio < DOWN_THRESHOLDS.WATCH_TO_NORMAL) {
      newState = STATES.NORMAL;
      entry.watchFrames = 0;
    } else if (waterRatio < DOWN_THRESHOLDS.ALERT_TO_WATCH) {
      newState = STATES.WATCH;
      entry.watchFrames = 0;
    }
    // else: stay ALERT
  }

  entry.state = newState;
  entry.lastRatio = waterRatio;
  entry.updatedAt = Date.now();

  // ── Emit alert only on upward transitions ───────────────────────────────
  const shouldAlert =
    (prevState === STATES.NORMAL && (newState === STATES.WATCH || newState === STATES.ALERT)) ||
    (prevState === STATES.WATCH  && newState === STATES.ALERT);

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
