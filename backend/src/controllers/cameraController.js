const Camera = require('../models/Camera');
const Event = require('../models/Event');
const { Readable } = require('stream');
const { isDatabaseConnected } = require('../config/database');
const { findHanoiCamera, getHanoiCameras, getHanoiSourceInfo } = require('../services/hanoiCameraService');
const { fetchSnapshot, findHcmCamera, getHcmCameras } = require('../services/hcmCameraService');
const {
  ensureHanoiProxyStarted,
  getHanoiProxyStatus,
  getProxyBaseUrl,
} = require('../services/hanoiProxyService');
const {
  checkCameraHealth,
  getCachedHealth,
  getCameraHealth,
  getHealthSummary,
} = require('../services/cameraHealthService');
const trafficVolumeService = require('../services/trafficVolumeService');

const FIRE_DEMO_VIDEO_URL = '/assets/demo/perry-fire.webm';
const FLOOD_DEMO_VIDEO_URL = '/assets/demo/flood-intersection.webm';
const TRAFFIC_DEMO_VIDEO_URL = '/assets/demo/rush-hour-traffic.webm';
const FIRE_DEMO_SOURCE_URL = 'https://upload.wikimedia.org/wikipedia/commons/transcoded/1/1a/Perry_Fire_Video_%2843953516241%29.webm/Perry_Fire_Video_%2843953516241%29.webm.480p.vp9.webm';
const FLOOD_DEMO_SOURCE_URL = 'https://upload.wikimedia.org/wikipedia/commons/transcoded/b/b2/Bahrain_Flooding_2024.webm/Bahrain_Flooding_2024.webm.480p.vp9.webm';
const TRAFFIC_DEMO_SOURCE_URL = 'https://upload.wikimedia.org/wikipedia/commons/transcoded/a/a3/Video_Codec_Test_rush_hour_1080p25.y4m.webm/Video_Codec_Test_rush_hour_1080p25.y4m.webm.480p.vp9.webm';

// Demo cameras used when MongoDB is not available
const DEMO_CAMERAS = [
  {
    camera_id: 'USB_CAM_001',
    name: 'USB Camera — Local',
    location: { lat: 11.9444, lng: 108.4441, address: 'USB Camera - Da Lat' },
    max_red_light_time: 10, // Lowered for quick testing
    active: true,
  },
  {
    camera_id: 'DEMO_FIRE_CAM_001',
    name: 'Camera mô phỏng — Sự cố cháy',
    location: {
      lat: 10.7731,
      lng: 106.7048,
      address: 'Quận 1 · Video mô phỏng sự cố cháy',
    },
    active: true,
    source: 'simulated_demo',
    stream_type: 'recorded_demo',
    stream_url: FIRE_DEMO_VIDEO_URL,
    metadata: {
      demo: true,
      recorded_footage: true,
      expected_event_type: 'fire',
      attribution: 'BLM Nevada · CC BY 2.0',
      attribution_url: 'https://commons.wikimedia.org/wiki/File:Perry_Fire_Video_(43953516241).webm',
      source_url: FIRE_DEMO_SOURCE_URL,
    },
  },
  {
    camera_id: 'DEMO_FLOOD_CAM_001',
    name: 'Camera mô phỏng — Tuyến đường ngập',
    location: {
      lat: 10.7570,
      lng: 106.7015,
      address: 'Quận 4 · Video mô phỏng ngập lụt',
    },
    active: true,
    source: 'simulated_demo',
    stream_type: 'recorded_demo',
    stream_url: FLOOD_DEMO_VIDEO_URL,
    metadata: {
      demo: true,
      recorded_footage: true,
      expected_event_type: 'flood',
      attribution: 'Droodkin · CC BY-SA 4.0',
      source_url: FLOOD_DEMO_SOURCE_URL,
    },
  },
  {
    camera_id: 'DEMO_TRAFFIC_CAM_001',
    name: 'Camera mô phỏng — Ùn tắc giờ cao điểm',
    location: {
      lat: 10.7913,
      lng: 106.6905,
      address: 'Quận 3 · Video mô phỏng ùn tắc giao thông',
    },
    active: true,
    source: 'simulated_demo',
    stream_type: 'recorded_demo',
    stream_url: TRAFFIC_DEMO_VIDEO_URL,
    metadata: {
      demo: true,
      recorded_footage: true,
      expected_event_type: 'traffic_jam',
      attribution: 'Taurus Media Technik · CC0 1.0',
      source_url: TRAFFIC_DEMO_SOURCE_URL,
    },
  },
  {
    camera_id: 'CAM_001',
    name: 'Nguyễn Huệ — Lê Lợi',
    location: { lat: 10.7739, lng: 106.7030, address: 'Nguyễn Huệ Walking Street, District 1, HCMC' },
    max_red_light_time: 90,
    active: true,
    source: 'local_demo',
    stream_type: 'proxy',
  },
  {
    camera_id: 'CAM_002',
    name: 'Điện Biên Phủ — Hai Bà Trưng',
    location: { lat: 10.7865, lng: 106.6953, address: 'Điện Biên Phủ & Hai Bà Trưng intersection, District 3, HCMC' },
    max_red_light_time: 120,
    active: true,
    source: 'local_demo',
    stream_type: 'proxy',
  },
  {
    camera_id: 'CAM_003',
    name: 'Bình Triệu Bridge',
    location: { lat: 10.8231, lng: 106.7114, address: 'Bình Triệu Bridge, Thủ Đức, HCMC' },
    max_red_light_time: 90,
    active: true,
    source: 'local_demo',
    stream_type: 'proxy',
  },
];

function mergeCameraLists(primary, extras) {
  const seen = new Set();
  return [...primary, ...extras].filter((camera) => {
    if (!camera?.camera_id || seen.has(camera.camera_id)) return false;
    seen.add(camera.camera_id);
    return true;
  });
}

const DEMO_CAMERA_LOCATIONS = {
  hanoi: {
    DEMO_FIRE_CAM_001: {
      lat: 21.0314,
      lng: 105.8523,
      address: 'Hoàn Kiếm · Video mô phỏng sự cố cháy',
    },
    DEMO_FLOOD_CAM_001: {
      lat: 21.0412,
      lng: 105.8346,
      address: 'Ba Đình · Video mô phỏng ngập lụt',
    },
    DEMO_TRAFFIC_CAM_001: {
      lat: 21.0127,
      lng: 105.8419,
      address: 'Hai Bà Trưng · Video mô phỏng ùn tắc giao thông',
    },
  },
};

function getSimulatedDemoCameras(req, city = 'hcm') {
  const explicitlyRequested = ['1', 'true', 'yes'].includes(
    String(req?.query?.include_demo || '').toLowerCase()
  );
  const enabled = explicitlyRequested || process.env.ENABLE_SIMULATED_CAMERA === 'true' || process.env.NODE_ENV !== 'production';
  if (!enabled) return [];

  return buildSimulatedDemoCameras(city);
}

function buildSimulatedDemoCameras(city = 'hcm') {
  return DEMO_CAMERAS
    .filter((camera) => camera.source === 'simulated_demo')
    .map((camera) => ({
      ...camera,
      location: DEMO_CAMERA_LOCATIONS[city]?.[camera.camera_id] || camera.location,
      metadata: {
        ...(camera.metadata || {}),
        demo_city: city,
      },
    }));
}

function cleanString(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

function extractYoutubeVideoId(value) {
  const input = cleanString(value, 500);
  if (!input) return null;

  try {
    const url = new URL(input);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') return cleanString(url.pathname.split('/').filter(Boolean)[0], 32);
    if (host.endsWith('youtube.com')) {
      if (url.searchParams.get('v')) return cleanString(url.searchParams.get('v'), 32);
      const parts = url.pathname.split('/').filter(Boolean);
      const markerIndex = parts.findIndex((part) => ['embed', 'shorts', 'live'].includes(part));
      if (markerIndex >= 0 && parts[markerIndex + 1]) return cleanString(parts[markerIndex + 1], 32);
    }
  } catch (_err) {
    return null;
  }

  return null;
}

function getYoutubeThumbnailUrl(value) {
  const videoId = extractYoutubeVideoId(value);
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault_live.jpg` : null;
}

function normalizeCommunityCamera(camera) {
  if (camera?.source !== 'user_contribution') return camera;
  const youtubeSnapshot = getYoutubeThumbnailUrl(camera.stream_url) || getYoutubeThumbnailUrl(camera.metadata?.original_url);
  const snapshotUrl =
    youtubeSnapshot ||
    camera.snapshot_url;

  if (!snapshotUrl) return camera;
  return {
    ...camera,
    snapshot_url: snapshotUrl,
    stream_type: 'snapshot',
    metadata: {
      ...(camera.metadata || {}),
      snapshot_refresh_ms: 5000,
    },
  };
}

async function getApprovedCommunityCameras() {
  if (isDatabaseConnected()) {
    const cameras = await Camera.find({
      active: { $ne: false },
      source: 'user_contribution',
    })
      .select('-token_hash')
      .sort({ created_at: -1 })
      .lean();
    return cameras.map(normalizeCommunityCamera);
  }

  return DEMO_CAMERAS
    .filter((camera) => camera.source === 'user_contribution' && camera.active !== false)
    .map(normalizeCommunityCamera);
}

/**
 * GET /api/cameras
 * Returns all cameras (optionally filtered by active status).
 * Falls back to demo data when MongoDB is not connected.
 */
async function getCameras(req, res) {
  try {
    if (req.query.source === 'hcm') {
      const communityCameras = await getApprovedCommunityCameras();
      return res.json({
        cameras: mergeCameraLists(
          [...getSimulatedDemoCameras(req), ...getHcmCameras(req.query.limit)],
          communityCameras
        ),
        source: 'hcm_traffic_portal_with_community',
      });
    }

    if (!isDatabaseConnected()) {
      return res.json({ cameras: DEMO_CAMERAS, demo: true });
    }

    const filter = {};
    if (req.query.active !== undefined) {
      filter.active = req.query.active === 'true';
    }
    if (req.query.source) {
      filter.source = req.query.source;
    }

    const cameras = await Camera.find(filter)
      .select('-token_hash')
      .sort({ camera_id: 1 })
      .lean();

    return res.json({ cameras });
  } catch (err) {
    console.error('[CameraController] Error:', err);
    // Fallback to demo data on error
    return res.json({ cameras: DEMO_CAMERAS, demo: true });
  }
}

/**
 * GET /api/cameras/hcm
 * Returns public HCMC traffic cameras exposed through the local snapshot proxy.
 */
async function getHcmTrafficCameras(req, res) {
  try {
    const communityCameras = await getApprovedCommunityCameras();
    return res.json({
      cameras: mergeCameraLists(
        [...getSimulatedDemoCameras(req, 'hcm'), ...getHcmCameras(req.query.limit)],
        communityCameras
      ),
      source: 'hcm_traffic_portal_with_community',
    });
  } catch (err) {
    console.error('[CameraController] HCM cameras error:', err);
    return res.status(500).json({ error: 'Unable to load HCM cameras' });
  }
}

/**
 * GET /api/cameras/hanoi
 * Returns public Hanoi traffic cameras with realtime WSS metadata.
 */
async function getHanoiTrafficCameras(req, res) {
  try {
    const cameras = await getHanoiCameras({
      limit: req.query.limit,
      refresh: req.query.refresh === 'true',
    });
    return res.json({
      cameras: mergeCameraLists(getSimulatedDemoCameras(req, 'hanoi'), cameras),
      source: 'hanoi_video_wall',
      stream_mode: 'wss_video',
      stream_playback: 'backend_mjpeg_proxy',
      proxy: getHanoiProxyStatus(),
      ...getHanoiSourceInfo(),
    });
  } catch (err) {
    console.error('[CameraController] Hanoi cameras error:', err);
    return res.status(500).json({ error: 'Unable to load Hanoi cameras' });
  }
}

/**
 * GET /api/cameras/hanoi/:cameraId/stream-info
 * Returns the realtime stream metadata for a Hanoi camera.
 */
async function getHanoiCameraStreamInfo(req, res) {
  try {
    const camera = await findHanoiCamera(req.params.cameraId);
    if (!camera) return res.status(404).json({ error: 'Hanoi camera not found' });
    return res.json({
      camera_id: camera.camera_id,
      name: camera.name,
      stream_type: camera.stream_type,
      stream_url: camera.stream_url,
      metadata: camera.metadata,
      proxy: getHanoiProxyStatus(),
      playback_note: 'The Hanoi source is decoded through the backend MJPEG proxy for browser playback.',
    });
  } catch (err) {
    console.error('[CameraController] Hanoi stream info error:', err);
    return res.status(500).json({ error: 'Unable to load Hanoi stream info' });
  }
}

/**
 * GET /api/cameras/hanoi/:cameraId/status
 * Returns decoder health for a Hanoi camera from the local WSS proxy.
 */
async function getHanoiCameraProxyStatus(req, res) {
  try {
    const camera = await findHanoiCamera(req.params.cameraId);
    if (!camera) return res.status(404).json({ error: 'Hanoi camera not found' });

    const proxyState = await ensureHanoiProxyStarted();
    if (!proxyState.available) {
      return res.status(503).json({
        error: 'Hanoi MJPEG proxy unavailable',
        proxy: {
          ...getHanoiProxyStatus(),
          ...proxyState,
        },
      });
    }

    const shouldStart = ['1', 'true', 'yes'].includes(String(req.query.start || '').toLowerCase());
    const statusUrl =
      `${getProxyBaseUrl()}/hanoi_status/${encodeURIComponent(camera.camera_id)}${shouldStart ? '?start=true' : ''}`;
    const upstream = await fetch(statusUrl, {
      signal: AbortSignal.timeout(Number(process.env.HANOI_PROXY_STATUS_TIMEOUT_MS || 2500)),
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: 'Unable to read Hanoi decoder status',
        proxy: getHanoiProxyStatus(),
      });
    }

    return res.json({
      camera_id: camera.camera_id,
      proxy: getHanoiProxyStatus(),
      status: await upstream.json(),
    });
  } catch (err) {
    console.error('[CameraController] Hanoi proxy status error:', err);
    return res.status(500).json({ error: 'Unable to load Hanoi proxy status' });
  }
}

/**
 * GET /api/cameras/hanoi/:cameraId/mjpeg
 * Proxies decoded MJPEG from the local Hanoi WSS proxy.
 */
async function proxyHanoiCameraMjpeg(req, res) {
  try {
    const camera = await findHanoiCamera(req.params.cameraId);
    if (!camera) return res.status(404).json({ error: 'Hanoi camera not found' });

    const proxyState = await ensureHanoiProxyStarted();
    if (!proxyState.available) {
      return res.status(503).json({
        error: 'Hanoi MJPEG proxy unavailable',
        message: 'The backend could not start or reach the Hanoi WSS decoder yet.',
        proxy: {
          ...getHanoiProxyStatus(),
          ...proxyState,
        },
      });
    }

    const proxyUrl =
      `${getProxyBaseUrl()}/hanoi_feed/${encodeURIComponent(camera.camera_id)}`;
    const upstream = await fetch(proxyUrl);

    if (!upstream.ok || !upstream.body) {
      return res.status(502).json({
        error: 'Hanoi MJPEG proxy unavailable',
        status: upstream.status,
        proxy: getHanoiProxyStatus(),
      });
    }

    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') || 'multipart/x-mixed-replace; boundary=frame'
    );
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Connection', 'keep-alive');

    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    console.error('[CameraController] Hanoi MJPEG proxy error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Unable to proxy Hanoi camera stream' });
    }
    res.end();
  }
}

/**
 * GET /api/cameras/health
 * Returns cached camera health states without hitting the upstream portal.
 */
async function getCameraHealthStatus(req, res) {
  try {
    return res.json({
      cameras: getCameraHealth({
        limit: req.query.limit,
        offset: req.query.offset,
      }),
      summary: getHealthSummary(),
    });
  } catch (err) {
    console.error('[CameraController] Camera health error:', err);
    return res.status(500).json({ error: 'Unable to load camera health' });
  }
}

/**
 * POST /api/cameras/health/check
 * Checks a bounded batch of camera snapshots and caches live/offline state.
 */
async function checkCameraHealthStatus(req, res) {
  try {
    const body = req.body || {};
    const result = await checkCameraHealth({
      cameraIds: body.camera_ids,
      concurrency: body.concurrency,
      limit: body.limit ?? req.query.limit,
      offset: body.offset ?? req.query.offset,
    });
    return res.json(result);
  } catch (err) {
    console.error('[CameraController] Camera health check error:', err);
    return res.status(500).json({ error: 'Unable to check camera health' });
  }
}

/**
 * GET /api/cameras/:cameraId/history
 * Returns camera-specific history for the detail panel.
 */
async function getCameraHistory(req, res) {
  try {
    const { cameraId } = req.params;
    const hours = Math.min(Math.max(Number.parseInt(req.query.hours, 10) || 24, 1), 24 * 14);
    const from = new Date(Date.now() - hours * 60 * 60 * 1000);
    let events = [];

    if (isDatabaseConnected()) {
      events = await Event.find({ camera_id: cameraId, timestamp: { $gte: from } })
        .sort({ timestamp: -1 })
        .limit(500)
        .select('-image_base64')
        .lean();
    }

    const counts = events.reduce((acc, event) => {
      acc[event.event_type] = (acc[event.event_type] || 0) + 1;
      return acc;
    }, { traffic_jam: 0, fire: 0, flood: 0 });

    return res.json({
      camera_id: cameraId,
      from: from.toISOString(),
      hours,
      events,
      summary: {
        total: events.length,
        counts,
        health: getCachedHealth(cameraId),
        traffic_volume: trafficVolumeService.getVolume(cameraId),
      },
    });
  } catch (err) {
    console.error('[CameraController] Camera history error:', err);
    return res.status(500).json({ error: 'Unable to load camera history' });
  }
}

/**
 * GET /api/cameras/:cameraId/snapshot
 * Proxies HCMC public camera frames and handles the portal session cookie.
 */
async function getCameraSnapshot(req, res) {
  try {
    const cameraId = req.params.cameraId;
    const hcmCamera = findHcmCamera(cameraId);
    let externalId = hcmCamera?.external_id || cameraId;

    if (!hcmCamera && isDatabaseConnected()) {
      const stored = await Camera.findOne({ camera_id: cameraId }).select('-token_hash').lean();
      if (stored?.source !== 'hcm_traffic_portal' || !stored.external_id) {
        return res.status(404).json({ error: 'Snapshot camera not found' });
      }
      externalId = stored.external_id;
    } else if (!hcmCamera) {
      return res.status(404).json({ error: 'Snapshot camera not found' });
    }

    const snapshot = await fetchSnapshot(externalId);
    res.setHeader('Content-Type', snapshot.contentType);
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(snapshot.buffer);
  } catch (err) {
    console.error('[CameraController] Snapshot error:', err);
    return res.status(err.statusCode || 502).json({
      error: err.issueType === 'unavailable_placeholder'
        ? 'Camera source returned an unavailable placeholder'
        : 'Unable to load camera snapshot',
      issue_type: err.issueType || null,
    });
  }
}

/**
 * POST /api/cameras/sync/hcm
 * Stores the HCMC public camera list in MongoDB for normal dashboard queries.
 */
async function syncHcmTrafficCameras(req, res) {
  try {
    const cameras = getHcmCameras(req.query.limit);

    if (!isDatabaseConnected()) {
      return res.status(503).json({
        error: 'Database not connected. HCM cameras can still be read from /api/cameras/hcm.',
        cameras,
      });
    }

    const operations = cameras.map((camera) => ({
      updateOne: {
        filter: { camera_id: camera.camera_id },
        update: { $set: camera },
        upsert: true,
      },
    }));

    const result = await Camera.bulkWrite(operations, { ordered: false });
    return res.json({
      synced: cameras.length,
      upserted: result.upsertedCount,
      modified: result.modifiedCount,
    });
  } catch (err) {
    console.error('[CameraController] HCM sync error:', err);
    return res.status(500).json({ error: 'Unable to sync HCM cameras' });
  }
}

/**
 * POST /api/cameras
 * Create or update a camera.
 */
async function upsertCamera(req, res) {
  try {
    if (!isDatabaseConnected()) {
      return res.status(503).json({ error: 'Database not connected. Running in demo mode.' });
    }

    const {
      camera_id,
      name,
      location,
      max_red_light_time,
      active,
      source,
      external_id,
      stream_type,
      stream_url,
      snapshot_url,
      metadata,
    } = req.body;

    if (!camera_id || !name || !location) {
      return res.status(400).json({
        error: 'Missing required fields: camera_id, name, location{lat,lng}',
      });
    }

    const camera = await Camera.findOneAndUpdate(
      { camera_id },
      {
        camera_id,
        name,
        location,
        max_red_light_time: max_red_light_time || 90,
        active: active !== undefined ? active : true,
        source: source || 'local',
        external_id: external_id || null,
        stream_type: stream_type || 'proxy',
        stream_url: stream_url || null,
        snapshot_url: snapshot_url || null,
        metadata: metadata || {},
      },
      { upsert: true, new: true, runValidators: true }
    );

    return res.status(201).json({ camera });
  } catch (err) {
    console.error('[CameraController] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  DEMO_CAMERAS,
  buildSimulatedDemoCameras,
  checkCameraHealthStatus,
  getCameraHistory,
  getCameraSnapshot,
  getCameraHealthStatus,
  getCameras,
  getHanoiCameraStreamInfo,
  getHanoiCameraProxyStatus,
  getHanoiTrafficCameras,
  getHcmTrafficCameras,
  proxyHanoiCameraMjpeg,
  syncHcmTrafficCameras,
  upsertCamera,
};
