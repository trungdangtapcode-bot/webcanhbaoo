// Quick test: fetch fresh WSS URL and connect with PONG response
const WS = require('ws');

const HANOI_API = 'https://cds.hanoi.gov.vn/api/1.0/public/video-wall-cameras-v2?refresh=false&page=1&per_page=5&id=&address=&name=&userId=42914592';
const HEADERS = {
  'accept': 'application/json', 'content-type': 'application/json',
  'x-language': 'vi', 'os_type': 'Android', 'mode': '514', 'placeid': '514',
  'userid': '42914592', 'deviceid': '8cb9ce181963c686', 'user-agent': 'Dart/3.3 (dart:io)',
  'authorization': 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiI0MjkxNDU5MiIsImF1ZCI6IjA5Njk4MTQ0MzUiLCJwd2RFeHAiOjE3ODYxNzE5MzkzODIsImV4cCI6MTc4NjE3MTkzOSwiZGV2aWNlSWQiOiI4Y2I5Y2UxODE5NjNjNjg2IiwiaWF0IjoxNzc4Mzk1OTM5fQ.BI8Mv0ECFn8j1gJaAtzSYRyOOplqxsycYT4gMHK19Zr-UzYQxa98lmMiUnFJzOcFwugKdi2O_bkjSBOMuMeDKEgEXJP5AYd_0lv0gKXlCymCDJu-ZE4qNuNrKkGXaOcWgWsINqkc9clq0p3I3tFMah_8DLHhEiY8r7_RmpWL9YTnlEYIYIjhmT4x9YT48Mi9MZaRIKt_TtgzGMbgQ8BKT6vDu9FR05oOviFie7zXGCsl9Ttazfx8yikKXGC_0PAcmFmVTBcUdtumjNyXvGT2_VEjOeMQ0OIjDQDolv2Xhzz2UD0UlxUQQ_Z8dQ2v3VPxBt6P_gJFGFrHTaMo6rrQ'
};

async function test() {
  console.log('Fetching cameras...');
  const res = await fetch(HANOI_API, { headers: HEADERS });
  const data = await res.json();
  console.log('Response keys:', Object.keys(data));
  const camList = data.data || data.cameras || data.results || [];
  console.log('Camera count:', camList.length);
  if (camList.length === 0) { console.log('Full response:', JSON.stringify(data).substring(0, 500)); process.exit(); return; }
  const cam = camList[0];
  console.log('Camera:', cam.name, 'ID:', cam.id);
  
  const wssStream = cam.profile[0].streams.find(s => s.protocol === 'WSS');
  const httpsStream = cam.profile[0].streams.find(s => s.protocol === 'HTTPS');
  console.log('WSS:', wssStream?.source);
  console.log('HTTPS:', httpsStream?.source);

  if (!wssStream) { console.log('No WSS stream'); process.exit(); return; }

  const ws = new WS(wssStream.source, { rejectUnauthorized: false });
  let n = 0;

  ws.on('open', () => console.log('WSS OPEN'));

  ws.on('message', (rawData) => {
    const buf = Buffer.from(rawData);
    n++;
    const text = buf.toString('utf8');
    console.log(`MSG#${n} len=${buf.length} text=[${text.substring(0, 50)}] hex=${buf.slice(0, 20).toString('hex')}`);
    
    if (text === 'PING') {
      console.log('>> Sending PONG');
      ws.send('PONG');
    }
    if (n >= 15) { ws.close(); }
  });

  ws.on('error', (e) => console.log('ERROR:', e.message));
  ws.on('close', (code) => { console.log('CLOSED code=', code, 'frames=', n); process.exit(); });

  setTimeout(() => { console.log('TIMEOUT after 20s, frames:', n); process.exit(); }, 20000);
}

test();
