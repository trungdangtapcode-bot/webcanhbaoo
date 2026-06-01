const express = require('express');
const router = express.Router();
const trafficVolumeService = require('../services/trafficVolumeService');

/**
 * GET /api/traffic/volume
 *
 * Returns real-time vehicle volume for all cameras that have been observed.
 *
 * Query params:
 *   minLevel — "NORMAL" | "MODERATE" | "HIGH" | "CRITICAL"
 *              (default: return all)
 *
 * Response:
 * {
 *   cameras: [
 *     {
 *       camera_id, camera_name, lat, lng,
 *       level, avgCount, lastUpdated
 *     }
 *   ],
 *   summary: { total, counts, topCameras }
 * }
 */
router.get('/volume', (req, res) => {
  const { minLevel } = req.query;
  const validLevels = new Set(['NORMAL', 'MODERATE', 'HIGH', 'CRITICAL']);
  const safeMinLevel = validLevels.has(minLevel) ? minLevel : undefined;

  const cameras = trafficVolumeService.getVolumes({ minLevel: safeMinLevel });
  const summary = trafficVolumeService.getSummary(5);

  return res.json({ cameras, summary });
});

router.get('/heatmap', (_req, res) => {
  return res.json({
    points: trafficVolumeService.getHeatmapPoints(),
    summary: trafficVolumeService.getSummary(5),
  });
});

module.exports = router;
