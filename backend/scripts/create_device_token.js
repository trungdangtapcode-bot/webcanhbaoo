/**
 * CLI: Generate a JWT device token for a camera and store token_hash in DB.
 *
 * Usage:
 *   node scripts/create_device_token.js <camera_id> [expiry]
 *
 * Examples:
 *   node scripts/create_device_token.js CAM_001
 *   node scripts/create_device_token.js CAM_001 365d
 */

require('dotenv').config();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Camera = require('../src/models/Camera');

async function main() {
  const cameraId = process.argv[2];
  const expiry = process.argv[3] || '365d';

  if (!cameraId) {
    console.error('Usage: node scripts/create_device_token.js <camera_id> [expiry]');
    console.error('  expiry examples: 30d, 365d, 1y');
    process.exit(1);
  }

  const secret = process.env.API_SECRET;
  if (!secret || secret.length < 32) {
    console.error('❌ API_SECRET must be set and at least 32 characters');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  // Verify camera exists
  const camera = await Camera.findOne({ camera_id: cameraId });
  if (!camera) {
    console.error(`❌ Camera "${cameraId}" not found. Run 'npm run seed' first.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  // Generate JWT
  const token = jwt.sign({ camera_id: cameraId }, secret, { expiresIn: expiry });

  // Hash the token and store in DB
  const tokenHash = await bcrypt.hash(token, 10);
  camera.token_hash = tokenHash;
  await camera.save();

  console.log(`\n🔑 Device token for ${cameraId}:`);
  console.log('─'.repeat(60));
  console.log(token);
  console.log('─'.repeat(60));
  console.log(`\n✅ token_hash saved to camera record`);
  console.log(`   Expiry: ${expiry}`);
  console.log(`\nUse this token in AI module .env as API_TOKEN`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
