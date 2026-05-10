const express = require('express');
const router = express.Router();
const { getCameras, upsertCamera } = require('../controllers/cameraController');

// GET /api/cameras — public (for dashboard)
router.get('/', getCameras);

// POST /api/cameras — create/update a camera
router.post('/', upsertCamera);

module.exports = router;
