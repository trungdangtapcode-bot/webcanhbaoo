const { createClient } = require('redis');

let pubClient = null;
let subClient = null;

/**
 * Create Redis pub/sub client pair for the Socket.io Redis adapter.
 * Returns { pubClient, subClient } — both connected.
 */
async function createRedisClients() {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';

  pubClient = createClient({ url });
  subClient = pubClient.duplicate();

  pubClient.on('error', (err) => console.error('[Redis:pub]', err.message));
  subClient.on('error', (err) => console.error('[Redis:sub]', err.message));

  await Promise.all([pubClient.connect(), subClient.connect()]);
  console.log('[Redis] Pub/Sub clients connected');

  return { pubClient, subClient };
}

function getPubClient() {
  return pubClient;
}

module.exports = { createRedisClients, getPubClient };
