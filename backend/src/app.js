const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const eventsRouter = require('./routes/events');
const camerasRouter = require('./routes/cameras');
const newsRouter = require('./routes/news');
const scannerRouter = require('./routes/scanner');
const trafficRouter = require('./routes/traffic');
const chatRouter = require('./routes/chat');

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
app.use('/api/cameras', camerasRouter);
app.use('/api/news', newsRouter);
app.use('/api/scanner', scannerRouter);
app.use('/api/traffic', trafficRouter);
app.use('/api/chat', chatRouter);

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
