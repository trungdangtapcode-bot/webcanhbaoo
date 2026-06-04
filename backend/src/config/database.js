const mongoose = require('mongoose');

let isConnected = false;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function ensureEventRetentionIndex() {
  const retentionDays = parsePositiveInt(process.env.EVENT_RETENTION_DAYS, 7);
  const expireAfterSeconds = retentionDays * 24 * 60 * 60;
  const collection = mongoose.connection.db.collection('events');

  try {
    const indexes = await collection.indexes();
    const timestampIndex = indexes.find((index) =>
      index.key &&
      Object.keys(index.key).length === 1 &&
      index.key.timestamp === 1
    );

    if (timestampIndex && timestampIndex.expireAfterSeconds !== expireAfterSeconds) {
      await collection.dropIndex(timestampIndex.name);
      console.log(`[DB] Dropped old Event timestamp index: ${timestampIndex.name}`);
    }

    await collection.createIndex(
      { timestamp: 1 },
      {
        expireAfterSeconds,
        name: 'event_timestamp_ttl',
      }
    );
    console.log(`[DB] Event TTL index ready (${retentionDays} days)`);
  } catch (err) {
    console.warn('[DB] Event TTL index setup skipped:', err.message);
  }
}

/**
 * Connect to MongoDB with retry logic.
 * Uses MONGODB_URI from environment variables.
 * If MONGODB_URI is not set, runs in demo mode (no persistence).
 */
async function connectDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn('[DB] MONGODB_URI is not set — running in DEMO mode (no persistence)');
    return;
  }

  mongoose.set('strictQuery', false);

  mongoose.connection.on('connected', () => {
    isConnected = true;
    console.log('[DB] MongoDB connected successfully');
  });

  mongoose.connection.on('error', (err) => {
    isConnected = false;
    console.error('[DB] MongoDB connection error:', err.message);
  });

  mongoose.connection.on('disconnected', () => {
    isConnected = false;
    console.warn('[DB] MongoDB disconnected');
  });

  try {
    await mongoose.connect(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    await ensureEventRetentionIndex();
  } catch (err) {
    console.error('[DB] Initial MongoDB connection failed:', err.message);
    console.warn('[DB] Server will continue in DEMO mode');
  }
}

function isDatabaseConnected() {
  return isConnected;
}

module.exports = { connectDatabase, isDatabaseConnected };
