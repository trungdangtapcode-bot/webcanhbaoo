const express = require('express');
const router = express.Router();

const HANOI_API = 'https://cds.hanoi.gov.vn/api/1.0/public/video-wall-cameras-v2?refresh=false&page=1&per_page=1000&id=&address=&name=&userId=42914592';

const HEADERS = {
  'accept': 'application/json',
  'content-type': 'application/json',
  'x-language': 'vi',
  'os_type': 'Android',
  'mode': '514',
  'placeid': '514',
  'userid': '42914592',
  'deviceid': '8cb9ce181963c686',
  'user-agent': 'Dart/3.3 (dart:io)',
  'authorization': 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiI0MjkxNDU5MiIsImF1ZCI6IjA5Njk4MTQ0MzUiLCJwd2RFeHAiOjE3ODYxNzE5MzkzODIsImV4cCI6MTc4NjE3MTkzOSwiZGV2aWNlSWQiOiI4Y2I5Y2UxODE5NjNjNjg2IiwiaWF0IjoxNzc4Mzk1OTM5fQ.BI8Mv0ECFn8j1gJaAtzSYRyOOplqxsycYT4gMHK19Zr-UzYQxa98lmMiUnFJzOcFwugKdi2O_bkjSBOMuMeDKEgEXJP5AYd_0lv0gKXlCymCDJu-ZE4qNuNrKkGXaOcWgWsINqkc9clq0p3I3tFMah_8DLHhEiY8r7_RmpWL9YTnlEYIYIjhmT4x9YT48Mi9MZaRIKt_TtgzGMbgQ8BKT6vDu9FR05oOviFie7zXGCsl9Ttazfx8yikKXGC_0PAcmFmVTBcUdtumjNyXvGT2_VEjOeMQ0OIjDQDolv2Xhzz2UD0UlxUQQ_Z8dQ2v3VPxBt6P_gJFGFrHTaMo6rrQ'
};

// Cache camera data for 5 minutes to avoid hammering the API
let cachedData = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

router.get('/', async (req, res) => {
  try {
    const now = Date.now();
    if (cachedData && (now - cacheTime) < CACHE_TTL) {
      return res.json(cachedData);
    }

    const response = await fetch(HANOI_API, { headers: HEADERS });
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json();
    cachedData = data;
    cacheTime = now;

    console.log(`[Hanoi API] Fetched ${(data.data || []).length} cameras`);
    res.json(data);
  } catch (err) {
    console.error('[Hanoi API] Proxy error:', err.message);
    // Return cached data if available, even if stale
    if (cachedData) {
      return res.json(cachedData);
    }
    res.status(502).json({ error: 'Failed to fetch Hanoi cameras', message: err.message });
  }
});

module.exports = router;
