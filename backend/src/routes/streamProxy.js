const express = require('express');
const router = express.Router();
const https = require('https');

const HANOI_API = 'https://cds.hanoi.gov.vn/api/1.0/public/video-wall-cameras-v2?refresh=false&page=1&per_page=1000&id=&address=&name=&userId=42914592';
const AUTH_TOKEN = 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiI0MjkxNDU5MiIsImF1ZCI6IjA5Njk4MTQ0MzUiLCJwd2RFeHAiOjE3ODYxNzE5MzkzODIsImV4cCI6MTc4NjE3MTkzOSwiZGV2aWNlSWQiOiI4Y2I5Y2UxODE5NjNjNjg2IiwiaWF0IjoxNzc4Mzk1OTM5fQ.BI8Mv0ECFn8j1gJaAtzSYRyOOplqxsycYT4gMHK19Zr-UzYQxa98lmMiUnFJzOcFwugKdi2O_bkjSBOMuMeDKEgEXJP5AYd_0lv0gKXlCymCDJu-ZE4qNuNrKkGXaOcWgWsINqkc9clq0p3I3tFMah_8DLHhEiY8r7_RmpWL9YTnlEYIYIjhmT4x9YT48Mi9MZaRIKt_TtgzGMbgQ8BKT6vDu9FR05oOviFie7zXGCsl9Ttazfx8yikKXGC_0PAcmFmVTBcUdtumjNyXvGT2_VEjOeMQ0OIjDQDolv2Xhzz2UD0UlxUQQ_Z8dQ2v3VPxBt6P_gJFGFrHTaMo6rrQ';

const COMMON_HEADERS = {
  'accept': 'application/json',
  'content-type': 'application/json',
  'x-language': 'vi',
  'os_type': 'Android',
  'mode': '514',
  'placeid': '514',
  'userid': '42914592',
  'deviceid': '8cb9ce181963c686',
  'user-agent': 'Dart/3.3 (dart:io)',
  'authorization': AUTH_TOKEN
};

/**
 * GET /api/stream/:cameraId
 * 
 * Proxies the HTTPS playback stream from VTS Cloud.
 * Uses fresh token by re-fetching camera data.
 */
router.get('/:cameraId', async (req, res) => {
  const { cameraId } = req.params;
  console.log(`[StreamProxy] Request for camera ${cameraId}`);

  try {
    // Fetch fresh camera data to get valid stream URL
    const apiRes = await fetch(HANOI_API, { headers: COMMON_HEADERS });
    const apiData = await apiRes.json();
    const camList = apiData.data || [];
    const cam = camList.find(c => String(c.id) === String(cameraId));

    if (!cam) {
      return res.status(404).json({ error: 'Camera not found' });
    }

    if (!cam.profile || !cam.profile[0] || !cam.profile[0].streams) {
      return res.status(404).json({ error: 'No streams available' });
    }

    // Try HTTPS stream first
    const httpsStream = cam.profile[0].streams.find(s => s.protocol === 'HTTPS');
    if (!httpsStream) {
      return res.status(404).json({ error: 'No HTTPS stream' });
    }

    const streamUrl = httpsStream.source;
    console.log(`[StreamProxy] Proxying HTTPS: ${streamUrl}`);

    // Proxy the HTTPS stream to the client
    const proxyReq = https.request(streamUrl, {
      headers: {
        'User-Agent': 'Dart/3.3 (dart:io)',
        'Authorization': AUTH_TOKEN,
      },
      rejectUnauthorized: false,
    }, (proxyRes) => {
      console.log(`[StreamProxy] Upstream status: ${proxyRes.statusCode} content-type: ${proxyRes.headers['content-type']}`);

      // Forward headers
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': proxyRes.headers['content-type'] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      });

      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error(`[StreamProxy] Proxy error:`, err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Stream proxy failed', message: err.message });
      }
    });

    proxyReq.end();

    // Clean up on client disconnect
    req.on('close', () => {
      proxyReq.destroy();
    });

  } catch (err) {
    console.error(`[StreamProxy] Error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
