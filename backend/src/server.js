require('dotenv').config();

// Force Google DNS to bypass ISP DNS blocks (e.g. Viettel blocking MongoDB Atlas SRV)
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const { connectDatabase } = require('./config/database');
const alertService = require('./services/alertService');
const scannerService = require('./services/multiCameraScannerService');
const trafficVolumeService = require('./services/trafficVolumeService');

const PORT = process.env.PORT || 3000;

function shouldAutostartScanner() {
  if (process.env.SCANNER_AUTOSTART !== 'true') return false;
  const pm2Instance = process.env.NODE_APP_INSTANCE;
  return pm2Instance === undefined || pm2Instance === '0';
}

async function bootstrap() {
  // --- Connect MongoDB ---
  await connectDatabase();

  // --- Create HTTP server ---
  const server = http.createServer(app);

  // --- Socket.io ---
  const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
  });

  // --- Redis adapter (optional — skip if REDIS_URL not set) ---
  const redisUrl = process.env.REDIS_URL;
  const redisDisabled =
    process.env.DISABLE_REDIS === 'true' ||
    ['0', 'false', 'off', 'disabled', 'none'].includes(String(redisUrl || '').toLowerCase());

  if (redisUrl && !redisDisabled) {
    try {
      const { createRedisClients } = require('./config/redis');
      const { createAdapter } = require('@socket.io/redis-adapter');
      const { pubClient, subClient } = await createRedisClients();
      io.adapter(createAdapter(pubClient, subClient));
      console.log('[Server] Socket.io Redis adapter enabled');
    } catch (err) {
      console.warn('[Server] Redis adapter skipped:', err.message);
    }
  } else {
    console.log('[Server] Running without Redis adapter (single instance mode)');
  }

  // --- Initialize alert service with io ---
  alertService.init(io);
  trafficVolumeService.init(io);

  if (shouldAutostartScanner()) {
    scannerService.start().catch((err) => {
      console.error('[Scanner] autostart failed:', err);
    });
  } else if (process.env.SCANNER_AUTOSTART === 'true') {
    console.log(`[Scanner] autostart skipped in PM2 worker ${process.env.NODE_APP_INSTANCE}`);
  }

  // --- Socket.io connection handler ---
  io.on('connection', (socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`);

    socket.on('disconnect', (reason) => {
      console.log(`[Socket.io] Client disconnected: ${socket.id} (${reason})`);
    });
  });

  // --- Start listening ---
  server.listen(PORT, () => {
    console.log(`\n🚀 Smart Alert API running on http://localhost:${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   Worker PID:  ${process.pid}\n`);
  });
}

bootstrap().catch((err) => {
  console.error('[Server] Fatal error during bootstrap:', err);
  process.exit(1);
});
