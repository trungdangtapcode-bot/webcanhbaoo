const express = require('express');
const scannerService = require('../services/multiCameraScannerService');

const router = express.Router();

router.get('/status', (_req, res) => {
  res.json(scannerService.getStatus());
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
