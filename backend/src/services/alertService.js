/**
 * Alert Service — Socket.io emission
 *
 * Broadcasts alert events to all connected dashboard clients.
 */

let ioInstance = null;

/**
 * Initialize with the Socket.io server instance.
 * @param {import('socket.io').Server} io
 */
function init(io) {
  ioInstance = io;
  console.log('[AlertService] Initialized');
}

/**
 * Emit an alert to all connected clients.
 *
 * @param {object} alertData
 * @param {string} alertData.camera_id
 * @param {string} alertData.event_type - traffic_jam | fire | flood
 * @param {string} alertData.severity - low | medium | high | critical
 * @param {string} [alertData.image_base64]
 * @param {number} alertData.lat
 * @param {number} alertData.lng
 * @param {string} alertData.camera_name
 * @param {Date}   alertData.timestamp
 * @param {object} [alertData.metadata]
 */
function emitAlert(alertData) {
  if (!ioInstance) {
    console.error('[AlertService] Socket.io not initialized');
    return;
  }

  const payload = {
    camera_id: alertData.camera_id,
    event_type: alertData.event_type,
    severity: alertData.severity,
    image_base64: alertData.image_base64 || null,
    lat: alertData.lat,
    lng: alertData.lng,
    camera_name: alertData.camera_name || alertData.camera_id,
    timestamp: alertData.timestamp || new Date().toISOString(),
    metadata: alertData.metadata || {},
  };

  ioInstance.emit('alert', payload);
  console.log(
    `[AlertService] 🚨 Alert emitted: ${payload.event_type} @ ${payload.camera_id} (${payload.severity})`
  );
}

module.exports = { init, emitAlert };
