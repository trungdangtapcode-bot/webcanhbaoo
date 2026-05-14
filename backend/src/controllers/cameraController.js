const Camera = require('../models/Camera');
const { isDatabaseConnected } = require('../config/database');

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
    camera_id: 'CAM_001',
    name: 'Nguyễn Huệ — Lê Lợi',
    location: { lat: 10.7739, lng: 106.7030, address: 'Nguyễn Huệ Walking Street, District 1, HCMC' },
    max_red_light_time: 90,
    active: true,
  },
  {
    camera_id: 'CAM_002',
    name: 'Điện Biên Phủ — Hai Bà Trưng',
    location: { lat: 10.7865, lng: 106.6953, address: 'Điện Biên Phủ & Hai Bà Trưng intersection, District 3, HCMC' },
    max_red_light_time: 120,
    active: true,
  },
  {
    camera_id: 'CAM_003',
    name: 'Bình Triệu Bridge',
    location: { lat: 10.8231, lng: 106.7114, address: 'Bình Triệu Bridge, Thủ Đức, HCMC' },
    max_red_light_time: 90,
    active: true,
  },
];

/**
 * GET /api/cameras
 * Returns all cameras (optionally filtered by active status).
 * Falls back to demo data when MongoDB is not connected.
 */
async function getCameras(req, res) {
  try {
    if (!isDatabaseConnected()) {
      return res.json({ cameras: DEMO_CAMERAS, demo: true });
    }

    const filter = {};
    if (req.query.active !== undefined) {
      filter.active = req.query.active === 'true';
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
 * POST /api/cameras
 * Create or update a camera.
 */
async function upsertCamera(req, res) {
  try {
    if (!isDatabaseConnected()) {
      return res.status(503).json({ error: 'Database not connected. Running in demo mode.' });
    }

    const { camera_id, name, location, max_red_light_time, active } = req.body;

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
      },
      { upsert: true, new: true, runValidators: true }
    );

    return res.status(201).json({ camera });
  } catch (err) {
    console.error('[CameraController] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { getCameras, upsertCamera, DEMO_CAMERAS };
