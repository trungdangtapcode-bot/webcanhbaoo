const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const eventsRouter  = require('./routes/events');
const camerasRouter = require('./routes/cameras');
const authRouter    = require('./routes/auth');
const chatbotRouter = require('./routes/chatbot');
const newsRouter    = require('./routes/news');
const scannerRouter = require('./routes/scanner');
const trafficRouter = require('./routes/traffic');
const chatRouter    = require('./routes/chat');

const app = express();

// --- Middleware ---
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('short'));
app.use(express.json({ limit: '10mb' })); // base64 images can be large
app.use(express.urlencoded({ extended: true }));

// --- Serve frontend static files ---
app.use(express.static(path.join(__dirname, '../../frontend')));

// --- API Routes ---
app.use('/api/auth',    authRouter);
app.use('/api/cameras', camerasRouter);
app.use('/api/events',  eventsRouter);
app.use('/api/chatbot', chatbotRouter);
app.use('/api/news',    newsRouter);
app.use('/api/scanner', scannerRouter);
app.use('/api/traffic', trafficRouter);
app.use('/api/chat',    chatRouter);

// --- Health check ---
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// --- Architectural Map Redirect ---
/**
 * @route   GET /codegraph
 * @desc    Redirect to the interactive architectural map (Understand Anything Dashboard)
 * @access  Public (for review purposes)
 */
app.get('/codegraph', (req, res) => {
  const DASHBOARD_URL = process.env.CODEGRAPH_URL || 'http://127.0.0.1:5173/?token=313602a1ec781183821e4a3e9a39508c';
  
  console.log(`[App] Redirecting to CodeGraph: ${DASHBOARD_URL}`);
  
  // Trả về một trang HTML trung gian nhỏ để trông chuyên nghiệp hơn hoặc chuyển hướng thẳng
  res.send(`
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Redirecting to CodeGraph</title>
        <meta http-equiv="refresh" content="2;url=${DASHBOARD_URL}">
        <style>
          body { 
            background: #0d1117; 
            color: #e6edf3; 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
            display: flex; 
            align-items: center; 
            justify-content: center; 
            height: 100vh; 
            margin: 0; 
          }
          .card { border: 1px solid #30363d; padding: 24px; border-radius: 8px; text-align: center; max-width: 400px; }
          .spinner { border: 3px solid rgba(255,255,255,.1); border-top: 3px solid #58a6ff; border-radius: 50%; width: 24px; height: 24px; animation: spin 1s linear infinite; margin: 20px auto; }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          h3 { margin: 0 0 10px 0; color: #58a6ff; }
          p { margin: 5px 0; line-height: 1.5; }
        </style>
      </head>
      <body>
        <div class="card">
          <h3>Đang mở Bản đồ Kiến trúc</h3>
          <p style="color: #8b949e; font-size: 14px;">Hệ thống đang chuyển hướng bạn đến trang phân tích mã nguồn trực quan.</p>
          <div class="spinner"></div>
          <p><a href="${DASHBOARD_URL}" style="color: #58a6ff; text-decoration: none; font-size: 13px; font-weight: 500;">Bấm vào đây nếu trình duyệt không tự chuyển hướng</a></p>
        </div>
      </body>
    </html>
  `);
});

// --- 404 fallback ---
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// --- Error handler ---
app.use((err, req, res, _next) => {
  console.error('[App] Unhandled error:', err);
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
