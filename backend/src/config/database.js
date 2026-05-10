const mongoose = require('mongoose');

let isConnected = false;

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
  } catch (err) {
    console.error('[DB] Initial MongoDB connection failed:', err.message);
    console.warn('[DB] Server will continue in DEMO mode');
  }
}

function isDatabaseConnected() {
  return isConnected;
}

module.exports = { connectDatabase, isDatabaseConnected };
