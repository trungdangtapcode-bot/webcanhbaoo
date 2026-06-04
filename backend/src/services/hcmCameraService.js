const HCM_TRAFFIC_BASE_URL = process.env.HCM_TRAFFIC_BASE_URL || 'https://giaothong.hochiminhcity.gov.vn';
const HCM_CAMERA_RENDER_BASE_URL =
  process.env.HCM_CAMERA_RENDER_BASE_URL || 'https://giaothong.hochiminhcity.gov.vn:8007';
const SESSION_TTL_MS = Number(process.env.HCM_CAMERA_SESSION_TTL_MS || 15 * 60 * 1000);
const SNAPSHOT_TIMEOUT_MS = Number(process.env.HCM_CAMERA_SNAPSHOT_TIMEOUT_MS || 12000);
const { cameras: HCM_CAMERA_SEEDS } = require('../data/hcmTrafficCameras.json');

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
  return `${HCM_CAMERA_RENDER_BASE_URL}/Render/CameraHandler.ashx?id=${encodeURIComponent(externalId)}`;
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

  return {
    contentType: response.headers.get('content-type') || 'image/jpeg',
    buffer: Buffer.from(await response.arrayBuffer()),
  };
}

module.exports = {
  fetchSnapshot,
  findHcmCamera,
  getHcmCameras,
};
