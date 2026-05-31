const Camera = require('../models/Camera');
const { isDatabaseConnected } = require('../config/database');
const { fetchSnapshot, findHcmCamera, getHcmCameras } = require('../services/hcmCameraService');

// Demo cameras used when MongoDB is not available
const DEMO_CAMERAS = [
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

/**
 * GET /api/cameras
 * Returns all cameras (optionally filtered by active status).
 * Falls back to demo data when MongoDB is not connected.
 */
async function getCameras(req, res) {
  try {
    if (req.query.source === 'hcm') {
      return res.json({
        cameras: getHcmCameras(req.query.limit),
        source: 'hcm_traffic_portal',
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
    return res.json({
      cameras: getHcmCameras(req.query.limit),
      source: 'hcm_traffic_portal',
    });
  } catch (err) {
    console.error('[CameraController] HCM cameras error:', err);
    return res.status(500).json({ error: 'Unable to load HCM cameras' });
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
    return res.status(err.statusCode || 502).json({ error: 'Unable to load camera snapshot' });
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
  getCameraSnapshot,
  getCameras,
  getHcmTrafficCameras,
  syncHcmTrafficCameras,
  upsertCamera,
};
