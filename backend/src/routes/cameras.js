const express = require('express');
const router = express.Router();
const {
  getCameraSnapshot,
  getCameras,
  getHcmTrafficCameras,
  syncHcmTrafficCameras,
  upsertCamera,
} = require('../controllers/cameraController');

// GET /api/cameras/hcm - public HCMC traffic cameras
router.get('/hcm', getHcmTrafficCameras);

// GET /api/cameras/:cameraId/snapshot - proxied live frame
router.get('/:cameraId/snapshot', getCameraSnapshot);

// POST /api/cameras/sync/hcm - persist HCMC cameras into MongoDB
router.post('/sync/hcm', syncHcmTrafficCameras);

// GET /api/cameras — public (for dashboard)
router.get('/', getCameras);

// POST /api/cameras — create/update a camera
router.post('/', upsertCamera);

module.exports = router;
