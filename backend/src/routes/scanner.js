const express = require('express');
const scannerService = require('../services/multiCameraScannerService');

const router = express.Router();

function getDetectorUrl() {
  return process.env.AI_DETECTOR_URL || 'http://127.0.0.1:5055/detect';
}

function getDetectorHealthUrl() {
  return getDetectorUrl().replace(/\/detect\/?$/, '/health');
}

router.get('/status', (_req, res) => {
  res.json(scannerService.getStatus());
});

router.get('/demo-health', async (_req, res) => {
  try {
    const response = await fetch(getDetectorHealthUrl(), { signal: AbortSignal.timeout(8000) });
    const payload = await response.json().catch(() => ({}));
    res.status(response.ok ? 200 : response.status).json(payload);
  } catch (err) {
    res.status(502).json({
      error: 'Detector health check failed',
      detail: err.message,
    });
  }
});

router.post('/demo-detect', async (req, res) => {
  try {
    const imageBase64 = String(req.body?.image_base64 || '').replace(/^data:image\/\w+;base64,/, '');
    if (!imageBase64) {
      return res.status(400).json({ error: 'image_base64 is required' });
    }

    const response = await fetch(getDetectorUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(35000),
      body: JSON.stringify({
        camera: {
          camera_id: req.body?.camera_id || 'browser_usb_demo',
          name: 'Browser USB Camera Demo',
          source: 'browser_usb_camera',
        },
        content_type: req.body?.content_type || 'image/jpeg',
        image_base64: imageBase64,
        metadata: {
          demo: true,
          width: req.body?.width,
          height: req.body?.height,
        },
        timestamp: new Date().toISOString(),
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (Array.isArray(payload.detections)) {
      payload.detections = payload.detections.filter((item) => item?.event_type !== 'traffic_volume');
    }
    res.status(response.ok ? 200 : response.status).json(payload);
  } catch (err) {
    console.error('[ScannerRoute] demo-detect error:', err);
    res.status(502).json({
      error: 'Unable to run detector demo',
      detail: err.message,
    });
  }
});

router.post('/start', async (req, res) => {
  try {
    const status = await scannerService.start(req.body || {});
    res.json(status);
  } catch (err) {
    console.error('[ScannerRoute] start error:', err);
    res.status(500).json({ error: 'Unable to start scanner' });
  }
});

router.post('/stop', (_req, res) => {
  res.json(scannerService.stop());
});

router.post('/scan-once', async (_req, res) => {
  try {
    const result = await scannerService.scanOnce();
    res.json(result);
  } catch (err) {
    console.error('[ScannerRoute] scan-once error:', err);
    res.status(500).json({ error: 'Unable to run scanner' });
  }
});

module.exports = router;
