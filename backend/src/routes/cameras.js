const express = require('express');
const router = express.Router();
const {
  checkCameraHealthStatus,
  getCameraHistory,
  getCameraHealthStatus,
  getCameraSnapshot,
  getCameras,
  getHanoiCameraStreamInfo,
  getHanoiTrafficCameras,
  getHcmTrafficCameras,
  syncHcmTrafficCameras,
  upsertCamera,
} = require('../controllers/cameraController');

// GET /api/cameras/hcm - public HCMC traffic cameras
router.get('/hcm', getHcmTrafficCameras);

// GET /api/cameras/hanoi - public Hanoi realtime video camera metadata
router.get('/hanoi', getHanoiTrafficCameras);

// GET /api/cameras/hanoi/:cameraId/stream-info - raw WSS/HTTPS source metadata
router.get('/hanoi/:cameraId/stream-info', getHanoiCameraStreamInfo);

// GET /api/cameras/health - cached live/offline camera health
router.get('/health', getCameraHealthStatus);

// POST /api/cameras/health/check - actively check camera snapshots
router.post('/health/check', checkCameraHealthStatus);

// GET /api/cameras/:cameraId/snapshot - proxied live frame
router.get('/:cameraId/snapshot', getCameraSnapshot);

// GET /api/cameras/:cameraId/history - camera detail history
router.get('/:cameraId/history', getCameraHistory);

// POST /api/cameras/sync/hcm - persist HCMC cameras into MongoDB
router.post('/sync/hcm', syncHcmTrafficCameras);

// GET /api/cameras — public (for dashboard)
router.get('/', getCameras);

// POST /api/cameras — create/update a camera
router.post('/', upsertCamera);

module.exports = router;
