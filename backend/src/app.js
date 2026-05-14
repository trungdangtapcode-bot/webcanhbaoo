const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const eventsRouter = require('./routes/events');
// [TEMPORARILY DISABLED] Camera feature removed
// const camerasRouter = require('./routes/cameras');
// const hanoiCamerasRouter = require('./routes/hanoiCameras');
// const streamProxyRouter = require('./routes/streamProxy');

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
app.use('/api/events', eventsRouter);
// [TEMPORARILY DISABLED] Camera routes
// app.use('/api/cameras', camerasRouter);
// app.use('/api/hanoi-cameras', hanoiCamerasRouter);
// app.use('/api/stream', streamProxyRouter);

// --- Health check ---
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// --- 404 fallback ---
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// --- Error handler ---
app.use((err, req, res, _next) => {
  console.error('[App] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
