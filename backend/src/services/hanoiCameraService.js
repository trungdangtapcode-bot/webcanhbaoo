const fs = require('fs');
const path = require('path');

const HANOI_CAMERA_API_URL =
  process.env.HANOI_CAMERA_API_URL ||
  'https://cds.hanoi.gov.vn/api/1.0/public/video-wall-cameras-v2?refresh=false&page=1&per_page=1000&id=&address=&name=&userId=42914592';
const HANOI_API_TOKEN = process.env.HANOI_API_TOKEN || '';
const HANOI_DEVICE_ID = process.env.HANOI_DEVICE_ID || '8cb9ce181963c686';
const HANOI_USER_ID = process.env.HANOI_USER_ID || '42914592';
const HANOI_PLACE_ID = process.env.HANOI_PLACE_ID || '514';
const HANOI_CACHE_TTL_MS = Number(process.env.HANOI_CACHE_TTL_MS || 10 * 60 * 1000);
const HANOI_CAMERA_CACHE_FILE =
  process.env.HANOI_CAMERA_CACHE_FILE || path.join(__dirname, '../../hanoi_cameras.json');

let cachedRows = null;
let cachedAt = 0;
let cachedSource = 'local_cache';

function authHeader() {
  if (!HANOI_API_TOKEN) return '';
  return HANOI_API_TOKEN.startsWith('Bearer ') ? HANOI_API_TOKEN : `Bearer ${HANOI_API_TOKEN}`;
}

function buildHeaders() {
  const headers = {
    accept: 'application/json',
    deviceid: HANOI_DEVICE_ID,
    mode: HANOI_PLACE_ID,
    os_type: 'Android',
    placeid: HANOI_PLACE_ID,
    'user-agent': 'Dart/3.3 (dart:io)',
    userid: HANOI_USER_ID,
    'x-language': 'vi',
  };
  const authorization = authHeader();
  if (authorization) headers.authorization = authorization;
  return headers;
}

function getPrimaryProfile(row) {
  return (row.profile || []).find((profile) => profile?.type_output === 'video') || row.profile?.[0] || {};
}

function getStream(row, protocol) {
  return (getPrimaryProfile(row).streams || []).find((stream) => stream.protocol === protocol)?.source || null;
}

function toCamera(row) {
  const cameraId = `HANOI_${row.id || row.camera_id}`;
  const profile = getPrimaryProfile(row);
  const httpsUrl = getStream(row, 'HTTPS');
  const wssUrl = getStream(row, 'WSS');

  return {
    camera_id: cameraId,
    name: row.name || cameraId,
    location: {
      lat: Number(row.lat),
      lng: Number(row.lng),
      address: row.address || row.ward_name || '',
    },
    max_red_light_time: 90,
    active: row.availability !== 0,
    source: 'hanoi_video_wall',
    external_id: String(row.id || row.camera_id || ''),
    stream_type: wssUrl ? 'wss_video' : 'proxy',
    stream_url: wssUrl,
    snapshot_url: null,
    metadata: {
      provider: 'Hanoi video wall',
      camera_id: row.camera_id || null,
      ward_name: row.ward_name || null,
      resolution: profile.resolution || null,
      width: profile.width || null,
      height: profile.height || null,
      https_url: httpsUrl,
      wss_url: wssUrl,
      stream_note: 'Hanoi realtime source is exposed as WSS; it needs a decoder/proxy before browser playback.',
    },
  };
}

function readLocalRows() {
  const raw = fs.readFileSync(HANOI_CAMERA_CACHE_FILE, 'utf8');
  const data = JSON.parse(raw);
  cachedSource = 'local_cache';
  return data.data || [];
}

async function fetchRemoteRows() {
  if (!HANOI_API_TOKEN) return null;
  const response = await fetch(HANOI_CAMERA_API_URL, { headers: buildHeaders() });
  if (!response.ok) {
    throw new Error(`Hanoi camera API failed with ${response.status}`);
  }
  const data = await response.json();
  cachedSource = 'hanoi_api';
  return data.data || [];
}

async function loadRows(refresh = false) {
  const now = Date.now();
  if (!refresh && cachedRows && now - cachedAt < HANOI_CACHE_TTL_MS) {
    return cachedRows;
  }

  try {
    cachedRows = (await fetchRemoteRows()) || readLocalRows();
  } catch (err) {
    console.warn('[HanoiCameraService] Falling back to local cache:', err.message);
    cachedRows = readLocalRows();
  }

  cachedAt = now;
  return cachedRows;
}

async function getHanoiCameras(options = {}) {
  const rows = await loadRows(options.refresh === true);
  const cameras = rows
    .map(toCamera)
    .filter((camera) =>
      Number.isFinite(camera.location.lat) &&
      Number.isFinite(camera.location.lng) &&
      camera.active
    );
  const safeLimit = Number(options.limit);
  return Number.isFinite(safeLimit) && safeLimit > 0 ? cameras.slice(0, safeLimit) : cameras;
}

async function findHanoiCamera(cameraIdOrExternalId) {
  const id = String(cameraIdOrExternalId || '');
  const cameras = await getHanoiCameras();
  return cameras.find((camera) => camera.camera_id === id || camera.external_id === id);
}

function getHanoiSourceInfo() {
  return {
    source: cachedSource,
    cached_at: cachedAt ? new Date(cachedAt).toISOString() : null,
    api_configured: Boolean(HANOI_API_TOKEN),
  };
}

module.exports = {
  findHanoiCamera,
  getHanoiCameras,
  getHanoiSourceInfo,
};
