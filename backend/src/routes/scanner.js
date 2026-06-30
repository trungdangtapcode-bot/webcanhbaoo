const express = require('express');
const scannerService = require('../services/multiCameraScannerService');
const alertService = require('../services/alertService');
const alertQueueService = require('../services/alertQueueService');
const Event = require('../models/Event');
const { isDatabaseConnected } = require('../config/database');
const { getPersistedEventImage } = require('../services/eventImagePolicy');

const router = express.Router();
const DEMO_SESSION_VERSION = 'incident-dashboard-v1';

const DEMO_INCIDENT_CAMERAS = [
  { cameraId: 'DEMO_FIRE_CAM_001', eventType: 'fire' },
  { cameraId: 'DEMO_FLOOD_CAM_001', eventType: 'flood' },
  { cameraId: 'DEMO_TRAFFIC_CAM_001', eventType: 'traffic_jam' },
];

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

router.post('/demo-reset', async (req, res) => {
  const requestedCameraId = String(req.body?.camera_id || '').trim();
  const targets = requestedCameraId
    ? DEMO_INCIDENT_CAMERAS.filter((item) => item.cameraId === requestedCameraId)
    : DEMO_INCIDENT_CAMERAS;

  for (const target of targets) {
    alertService.clearAlert(target.cameraId, target.eventType, {
      force: true,
      reason: 'demo_reset',
      timestamp: new Date(),
      metadata: { demo: true },
    });
    await alertQueueService.deleteQueueItem(target.cameraId, target.eventType);
  }

  res.json({
    success: true,
    reset: targets.map((item) => item.cameraId),
    alerts: alertService.getActiveAlerts(),
  });
});

router.post('/demo-detect', async (req, res) => {
  try {
    const imageBase64 = String(req.body?.image_base64 || '').replace(/^data:image\/\w+;base64,/, '');
    if (!imageBase64) {
      return res.status(400).json({ error: 'image_base64 is required' });
    }

    const cameraId = req.body?.camera_id || 'USB_CAM_001';
    const cameraName = req.body?.camera_name || 'USB Camera — Local';
    const cameraSource = req.body?.camera_source || 'browser_usb_camera';
    if (
      cameraSource === 'recorded_demo_camera' &&
      req.body?.demo_session !== DEMO_SESSION_VERSION
    ) {
      return res.status(409).json({
        error: 'Recorded demo session is outdated',
        detail: 'Reload the dashboard or detector demo before running the recorded camera.',
        demo_session: DEMO_SESSION_VERSION,
      });
    }
    const expectedEventType = req.body?.expected_event_type || null;
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    const hasLocation = Number.isFinite(lat) && Number.isFinite(lng);

    const response = await fetch(getDetectorUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(35000),
      body: JSON.stringify({
        camera: {
          camera_id: cameraId,
          name: cameraName,
          source: cameraSource,
        },
        content_type: req.body?.content_type || 'image/jpeg',
        image_base64: imageBase64,
        metadata: {
          demo: true,
          simulated_source: cameraSource === 'recorded_demo_camera',
          expected_event_type: expectedEventType,
          width: req.body?.width,
          height: req.body?.height,
        },
        timestamp: new Date().toISOString(),
      }),
    });

    const payload = await response.json().catch(() => ({}));
    
    if (Array.isArray(payload.detections)) {
      for (const det of payload.detections) {
        if (det.event_type === 'fire' || det.event_type === 'flood' || det.event_type === 'traffic_jam') {
          const activeResult = alertService.upsertActiveAlert({
            camera_id: cameraId,
            camera_name: cameraName,
            confidence: det.confidence,
            event_type: det.event_type,
            image_base64: imageBase64,
            lat: hasLocation ? lat : undefined,
            lng: hasLocation ? lng : undefined,
            metadata: {
              ...det.metadata,
              demo: true,
              simulated_source: cameraSource === 'recorded_demo_camera',
              source: cameraSource,
              expected_event_type: expectedEventType,
            },
            severity: det.severity || 'medium',
            timestamp: new Date(),
          });
          
          if (activeResult.created && isDatabaseConnected()) {
            try {
              const persistedImage = getPersistedEventImage(imageBase64, {
                active: true,
                event_type: det.event_type,
                severity: det.severity || 'medium',
              });
              await Event.create({
                camera_id: cameraId,
                confidence: det.confidence,
                event_type: det.event_type,
                image_base64: persistedImage,
                metadata: {
                  ...det.metadata,
                  demo: true,
                  simulated_source: cameraSource === 'recorded_demo_camera',
                  source: cameraSource,
                  expected_event_type: expectedEventType,
                },
                severity: det.severity || 'medium',
                timestamp: new Date(),
              });
            } catch (err) {
              console.error('[ScannerRoute] Event persistence failed:', err.message);
            }
          }
        }
      }
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
