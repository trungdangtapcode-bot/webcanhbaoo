/**
 * Flood detection state machine with hysteresis and confirmation.
 *
 * WATCH is only an internal candidate state. The dashboard exposes an active
 * flood alert after confirmed ALERT readings, which reduces false positives
 * from rain, wet asphalt, puddles, and reflections.
 */

const STATES = {
  NORMAL: 'NORMAL',
  WATCH: 'WATCH',
  ALERT: 'ALERT',
};

function readNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function readInteger(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const UP_THRESHOLDS = {
  WATCH: readNumber('FLOOD_WATCH_RATIO', 0.22),
  ALERT: readNumber('FLOOD_ALERT_RATIO', 0.38),
};

const DOWN_THRESHOLDS = {
  WATCH_TO_NORMAL: readNumber('FLOOD_WATCH_CLEAR_RATIO', 0.14),
  ALERT_TO_WATCH: readNumber('FLOOD_ALERT_CLEAR_RATIO', 0.28),
};

const ALERT_CONFIRM_FRAMES = readInteger('FLOOD_ALERT_CONFIRM_FRAMES', 3);

// Map<camera_id, { state, lastRatio, updatedAt, alertFrames }>
const floodStates = new Map();

function makeInitialState() {
  return {
    state: STATES.NORMAL,
    lastRatio: 0,
    updatedAt: Date.now(),
    alertFrames: 0,
  };
}

/**
 * Evaluate a flood frame and determine if a visible alert transition occurred.
 *
 * @param {string} cameraId
 * @param {number} waterRatio - 0.0 to 1.0
 * @returns {{ shouldAlert: boolean, state: string, prevState: string, severity: string, alertFrames: number, thresholds: object }}
 */
function evaluate(cameraId, waterRatio) {
  if (!floodStates.has(cameraId)) {
    floodStates.set(cameraId, makeInitialState());
  }

  const ratio = Number.isFinite(Number(waterRatio)) ? Number(waterRatio) : 0;
  const entry = floodStates.get(cameraId);
  const prevState = entry.state;
  let newState = prevState;

  if (prevState === STATES.NORMAL) {
    if (ratio >= UP_THRESHOLDS.ALERT) {
      entry.alertFrames += 1;
      newState = entry.alertFrames >= ALERT_CONFIRM_FRAMES ? STATES.ALERT : STATES.WATCH;
    } else if (ratio >= UP_THRESHOLDS.WATCH) {
      entry.alertFrames = 0;
      newState = STATES.WATCH;
    } else {
      entry.alertFrames = 0;
      newState = STATES.NORMAL;
    }
  } else if (prevState === STATES.WATCH) {
    if (ratio >= UP_THRESHOLDS.ALERT) {
      entry.alertFrames += 1;
      newState = entry.alertFrames >= ALERT_CONFIRM_FRAMES ? STATES.ALERT : STATES.WATCH;
    } else if (ratio < DOWN_THRESHOLDS.WATCH_TO_NORMAL) {
      entry.alertFrames = 0;
      newState = STATES.NORMAL;
    } else {
      entry.alertFrames = 0;
      newState = STATES.WATCH;
    }
  } else if (prevState === STATES.ALERT) {
    if (ratio < DOWN_THRESHOLDS.WATCH_TO_NORMAL) {
      entry.alertFrames = 0;
      newState = STATES.NORMAL;
    } else if (ratio < DOWN_THRESHOLDS.ALERT_TO_WATCH) {
      entry.alertFrames = 0;
      newState = STATES.WATCH;
    } else {
      entry.alertFrames = ALERT_CONFIRM_FRAMES;
      newState = STATES.ALERT;
    }
  }

  entry.state = newState;
  entry.lastRatio = ratio;
  entry.updatedAt = Date.now();

  const shouldAlert = prevState !== STATES.ALERT && newState === STATES.ALERT;

  let severity = 'low';
  if (newState === STATES.ALERT) severity = 'high';
  else if (newState === STATES.WATCH) severity = 'medium';

  return {
    shouldAlert,
    state: newState,
    prevState,
    severity,
    alertFrames: entry.alertFrames,
    thresholds: {
      ...UP_THRESHOLDS,
      alertConfirmFrames: ALERT_CONFIRM_FRAMES,
    },
  };
}

function getState(cameraId) {
  return floodStates.get(cameraId) || makeInitialState();
}

function resetState(cameraId) {
  floodStates.delete(cameraId);
}

module.exports = { evaluate, getState, resetState, STATES };
