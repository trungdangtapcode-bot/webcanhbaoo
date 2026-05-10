/**
 * Seed script — creates 3 demo cameras in HCM City area.
 * Usage: node scripts/seed.js
 */

require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
const mongoose = require('mongoose');
const Camera = require('../src/models/Camera');

const demoCameras = [
  {
    camera_id: 'CAM_001',
    name: 'Nguyễn Huệ — Lê Lợi',
    location: {
      lat: 10.7739,
      lng: 106.7030,
      address: 'Nguyễn Huệ Walking Street, District 1, HCMC',
    },
    max_red_light_time: 90,
    active: true,
  },
  {
    camera_id: 'CAM_002',
    name: 'Điện Biên Phủ — Hai Bà Trưng',
    location: {
      lat: 10.7865,
      lng: 106.6953,
      address: 'Điện Biên Phủ & Hai Bà Trưng intersection, District 3, HCMC',
    },
    max_red_light_time: 120,
    active: true,
  },
  {
    camera_id: 'CAM_003',
    name: 'Bình Triệu Bridge',
    location: {
      lat: 10.8231,
      lng: 106.7114,
      address: 'Bình Triệu Bridge, Thủ Đức, HCMC',
    },
    max_red_light_time: 90,
    active: true,
  },
];

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI not set. Copy .env.example to .env and configure it.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');

  for (const cam of demoCameras) {
    const result = await Camera.findOneAndUpdate(
      { camera_id: cam.camera_id },
      cam,
      { upsert: true, new: true }
    );
    console.log(`   📷 Seeded: ${result.camera_id} — ${result.name}`);
  }

  console.log(`\n✅ Seeded ${demoCameras.length} cameras successfully`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
