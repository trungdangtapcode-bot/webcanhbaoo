const HCM_TRAFFIC_BASE_URL = process.env.HCM_TRAFFIC_BASE_URL || 'https://giaothong.hochiminhcity.gov.vn';
const HCM_CAMERA_RENDER_BASE_URL =
  process.env.HCM_CAMERA_RENDER_BASE_URL || 'https://giaothong.hochiminhcity.gov.vn:8007';
const SESSION_TTL_MS = Number(process.env.HCM_CAMERA_SESSION_TTL_MS || 15 * 60 * 1000);
const SNAPSHOT_TIMEOUT_MS = Number(process.env.HCM_CAMERA_SNAPSHOT_TIMEOUT_MS || 12000);

const HCM_CAMERA_SEEDS = [
  ['HCM_662b86c41afb9c00172dd31c', 'Dien Bien Phu - Nguyen Binh Khiem', 10.79011, 106.70402, 'District 1, Ho Chi Minh City', '662b86c41afb9c00172dd31c'],
  ['HCM_5a6065c58576340017d06615', 'Quoc lo 13 - Pham Van Dong', 10.82771, 106.72105, 'Thu Duc, Ho Chi Minh City', '5a6065c58576340017d06615'],
  ['HCM_6623f4df6f998a001b2528eb', 'Vo Nguyen Giap - Do Xuan Hop', 10.8355, 106.7658, 'Thu Duc, Ho Chi Minh City', '6623f4df6f998a001b2528eb'],
  ['HCM_662b7ce71afb9c00172dc676', 'Nguyen Van Troi - Hoang Van Thu', 10.79785, 106.66826, 'Phu Nhuan, Ho Chi Minh City', '662b7ce71afb9c00172dc676'],
  ['HCM_583f969161cfea0012cf68f7', 'Cong Truong Dan Chu', 10.777664, 106.681336, 'District 3, Ho Chi Minh City', '583f969161cfea0012cf68f7'],
  ['HCM_6623e8da6f998a001b2524a6', 'Nam Ky Khoi Nghia - Ham Nghi', 10.770969, 106.701128, 'District 1, Ho Chi Minh City', '6623e8da6f998a001b2524a6'],
  ['HCM_56de42f611f398ec0c481299', 'Vo Van Kiet - Nguyen Van Cu', 10.753642, 106.686441, 'District 5, Ho Chi Minh City', '56de42f611f398ec0c481299'],
  ['HCM_595dc29c3dcfc400106f2894', 'Quoc lo 1 - An Suong', 10.84792, 106.61231, 'District 12, Ho Chi Minh City', '595dc29c3dcfc400106f2894'],
  ['HCM_6623f1046f998a001b2527db', 'Au Co - Luy Ban Bich', 10.795748, 106.638236, 'Tan Phu, Ho Chi Minh City', '6623f1046f998a001b2527db'],
  ['HCM_5d9de4de766c880017188cbb', 'Truong Son - Cuu Long', 10.81251, 106.66574, 'Tan Binh, Ho Chi Minh City', '5d9de4de766c880017188cbb'],
  ['HCM_6623f44f6f998a001b2528aa', 'Mai Chi Tho - Nguyen Co Thach', 10.773214, 106.722586, 'Thu Duc, Ho Chi Minh City', '6623f44f6f998a001b2528aa'],
  ['HCM_662a881a1afb9c00172d2559', 'Nguyen Van Linh - Huynh Tan Phat', 10.752545, 106.728331, 'District 7, Ho Chi Minh City', '662a881a1afb9c00172d2559'],
  ['HCM_5a605f828576340017d06608', 'Binh Trieu Bridge', 10.8231, 106.7114, 'Thu Duc, Ho Chi Minh City', '5a605f828576340017d06608'],
  ['HCM_662b4ecb1afb9c00172d8692', 'Le Van Sy - Hoang Van Thu', 10.79808, 106.66772, 'Tan Binh, Ho Chi Minh City', '662b4ecb1afb9c00172d8692'],
  ['HCM_5deb576d1dc17d7c5515ad15', 'Ly Thai To Roundabout', 10.76275, 106.67979, 'District 10, Ho Chi Minh City', '5deb576d1dc17d7c5515ad15'],
  ['HCM_63ae7a50bfd3d90017e8f2b2', 'Ba Thang Hai - Ly Thuong Kiet', 10.764461, 106.659817, 'District 10, Ho Chi Minh City', '63ae7a50bfd3d90017e8f2b2'],
  ['HCM_587ee0ecb807da0011e33d50', 'Phan Dang Luu - Phan Xich Long', 10.802039, 106.683233, 'Phu Nhuan, Ho Chi Minh City', '587ee0ecb807da0011e33d50'],
  ['HCM_5ad0621c98d8fc001102e268', 'Ly Tu Trong - Hai Ba Trung', 10.779138, 106.702335, 'District 1, Ho Chi Minh City', '5ad0621c98d8fc001102e268'],
  ['HCM_662b85bf1afb9c00172dd149', 'Nam Ky Khoi Nghia - Le Thanh Ton', 10.774706, 106.699482, 'District 1, Ho Chi Minh City', '662b85bf1afb9c00172dd149'],
  ['HCM_56f8e796025e9511002786cf', 'Thu Thiem Tunnel - Toll Station', 10.771518, 106.717844, 'Thu Duc, Ho Chi Minh City', '56f8e796025e9511002786cf'],
  ['HCM_6318283cc9eae60017a19f0c', 'Nguyen Thi Minh Khai - Dinh Tien Hoang', 10.78661, 106.701568, 'District 1, Ho Chi Minh City', '6318283cc9eae60017a19f0c'],
  ['HCM_63b54f70bfd3d90017ea7c86', 'Sai Gon Bridge', 10.798561, 106.726277, 'Thu Duc, Ho Chi Minh City', '63b54f70bfd3d90017ea7c86'],
  ['HCM_5a8267fe5058170011f6eae1', 'Le Van Luong - Rach Dia Bridge', 10.723579, 106.697701, 'District 7, Ho Chi Minh City', '5a8267fe5058170011f6eae1'],
  ['HCM_662b83381afb9c00172dcf88', 'Hai Ba Trung - Nguyen Dinh Chieu', 10.784692, 106.695957, 'District 3, Ho Chi Minh City', '662b83381afb9c00172dcf88'],
];

let cachedCookieHeader = '';
let sessionExpiresAt = 0;

function toCamera(row) {
  const [cameraId, name, lat, lng, address, externalId] = row;
  return {
    camera_id: cameraId,
    name,
    location: { lat, lng, address },
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
