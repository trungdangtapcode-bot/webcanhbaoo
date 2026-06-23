const HCM_TRAFFIC_BASE_URL = process.env.HCM_TRAFFIC_BASE_URL || 'https://giaothong.hochiminhcity.gov.vn';
const crypto = require('crypto');
const HCM_CAMERA_RENDER_BASE_URL =
  process.env.HCM_CAMERA_RENDER_BASE_URL || 'https://giaothong.hochiminhcity.gov.vn:8007';
const SESSION_TTL_MS = Number(process.env.HCM_CAMERA_SESSION_TTL_MS || 15 * 60 * 1000);
const SNAPSHOT_TIMEOUT_MS = Number(process.env.HCM_CAMERA_SNAPSHOT_TIMEOUT_MS || 12000);
const DEFAULT_SNAPSHOT_WIDTH = Number(process.env.HCM_CAMERA_SNAPSHOT_WIDTH || 640);
const DEFAULT_SNAPSHOT_HEIGHT = Number(process.env.HCM_CAMERA_SNAPSHOT_HEIGHT || 360);
const { cameras: HCM_CAMERA_SEEDS } = require('../data/hcmTrafficCameras.json');

const HCM_UNAVAILABLE_PNG_HASHES = new Set([
  '2a9b6294e69278aee39e6489563dcd174e9490e5',
  'c2d6b5a633943d0625a503b2e477b29c7e6717b9',
]);

let cachedCookieHeader = '';
let sessionExpiresAt = 0;

function toCamera(row) {
  const externalId = row.external_id;
  const cameraId = `HCM_${externalId}`;
  return {
    camera_id: cameraId,
    name: row.name,
    location: { lat: row.lat, lng: row.lng, address: row.address },
    max_red_light_time: 90,
    active: true,
    source: 'hcm_traffic_portal',
    external_id: externalId,
    stream_type: 'snapshot',
    snapshot_url: `/api/cameras/${encodeURIComponent(cameraId)}/snapshot`,
    metadata: {
      provider: 'Ho Chi Minh City traffic portal',
      render_url: buildRenderUrl(externalId),
    },
  };
}

function getHcmCameras(limit) {
  const cameras = HCM_CAMERA_SEEDS.map(toCamera);
  const safeLimit = Number(limit);
  return Number.isFinite(safeLimit) && safeLimit > 0 ? cameras.slice(0, safeLimit) : cameras;
}

function findHcmCamera(cameraIdOrExternalId) {
  const id = String(cameraIdOrExternalId || '');
  return getHcmCameras().find((camera) => camera.camera_id === id || camera.external_id === id);
}

function buildRenderUrl(externalId) {
  const params = new URLSearchParams({
    id: externalId,
    bg: 'black',
  });
  if (Number.isFinite(DEFAULT_SNAPSHOT_WIDTH) && DEFAULT_SNAPSHOT_WIDTH > 0) {
    params.set('w', String(DEFAULT_SNAPSHOT_WIDTH));
  }
  if (Number.isFinite(DEFAULT_SNAPSHOT_HEIGHT) && DEFAULT_SNAPSHOT_HEIGHT > 0) {
    params.set('h', String(DEFAULT_SNAPSHOT_HEIGHT));
  }
  return `${HCM_CAMERA_RENDER_BASE_URL}/Render/CameraHandler.ashx?${params.toString()}`;
}

function collectCookies(headers) {
  const setCookie = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : String(headers.get('set-cookie') || '').split(/,(?=\s*[^;,]+=)/);

  return setCookie
    .map((cookie) => cookie.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

async function primeSession(force = false) {
  const now = Date.now();
  if (!force && cachedCookieHeader && now < sessionExpiresAt) {
    return cachedCookieHeader;
  }

  const response = await fetch(`${HCM_TRAFFIC_BASE_URL}/map.aspx`, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'SmartAlertSystem/1.0 (+local dashboard)',
    },
  });

  if (!response.ok) {
    throw new Error(`HCM traffic portal session failed with ${response.status}`);
  }

  cachedCookieHeader = collectCookies(response.headers);
  sessionExpiresAt = now + SESSION_TTL_MS;

  if (!cachedCookieHeader) {
    throw new Error('HCM traffic portal did not return a session cookie');
  }

  return cachedCookieHeader;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SNAPSHOT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sha1(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

function isPng(buffer) {
  return buffer.length >= 24 && buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
}

function isUnavailablePlaceholder(buffer) {
  if (!isPng(buffer)) return false;
  const hash = sha1(buffer);
  if (HCM_UNAVAILABLE_PNG_HASHES.has(hash)) return true;

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return (
    buffer.length < 16000 &&
    width >= 250 &&
    width <= 700 &&
    height >= 150 &&
    height <= 450
  );
}

async function fetchSnapshot(cameraIdOrExternalId) {
  const camera = findHcmCamera(cameraIdOrExternalId);
  const rawId = String(cameraIdOrExternalId || '');
  const externalId = camera?.external_id || rawId;

  if (!/^[a-f0-9]{24}$/i.test(externalId)) {
    const err = new Error('Unknown HCM camera');
    err.statusCode = 404;
    throw err;
  }

  const url = buildRenderUrl(externalId);
  let cookie = await primeSession();
  let response = await fetchWithTimeout(url, {
    headers: {
      accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      cookie,
      referer: `${HCM_TRAFFIC_BASE_URL}/map.aspx`,
      'user-agent': 'SmartAlertSystem/1.0 (+local dashboard)',
    },
  });

  if (response.status === 401 || response.status === 403) {
    cookie = await primeSession(true);
    response = await fetchWithTimeout(url, {
      headers: {
        accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        cookie,
        referer: `${HCM_TRAFFIC_BASE_URL}/map.aspx`,
        'user-agent': 'SmartAlertSystem/1.0 (+local dashboard)',
      },
    });
  }

  if (!response.ok) {
    const err = new Error(`HCM camera snapshot failed with ${response.status}`);
    err.statusCode = response.status;
    throw err;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (isUnavailablePlaceholder(buffer)) {
    const err = new Error('HCM camera returned IMAGE NOT AVAILABLE placeholder');
    err.statusCode = 503;
    err.issueType = 'unavailable_placeholder';
    throw err;
  }

  const contentType = isPng(buffer)
    ? 'image/png'
    : response.headers.get('content-type') || 'image/jpeg';

  return {
    contentType,
    buffer,
  };
}

module.exports = {
  buildRenderUrl,
  fetchSnapshot,
  findHcmCamera,
  getHcmCameras,
  isUnavailablePlaceholder,
};
