const VALID_MODES = new Set(['all', 'active', 'critical', 'none']);

function getEventImageStorageMode() {
  const mode = String(process.env.EVENT_IMAGE_STORAGE || 'all').trim().toLowerCase();
  return VALID_MODES.has(mode) ? mode : 'all';
}

function shouldPersistEventImage(context = {}) {
  const mode = getEventImageStorageMode();
  if (mode === 'none') return false;
  if (mode === 'critical') return context.severity === 'critical';
  if (mode === 'active') return Boolean(context.active);
  return true;
}

function getPersistedEventImage(imageBase64, context = {}) {
  if (!imageBase64 || !shouldPersistEventImage(context)) return null;
  return imageBase64;
}

module.exports = {
  getEventImageStorageMode,
  getPersistedEventImage,
  shouldPersistEventImage,
};
