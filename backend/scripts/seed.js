/**
 * Seed script: Tạo tài khoản admin mặc định
 * Run: node scripts/seed.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

// Force Google DNS to bypass ISP DNS blocks (e.g. Viettel blocking MongoDB Atlas SRV)
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const mongoose = require('mongoose');
const User = require('../src/models/User');

async function seed() {
  console.log('[Seed] Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);

  const existing = await User.findOne({ username: 'admin' });
  if (existing) {
    console.log('[Seed] Admin user already exists. Skipping.');
    await mongoose.disconnect();
    return;
  }

  const admin = await User.create({
    username: 'admin',
    email: 'admin@smartalert.local',
    password: 'Admin@123456',      // Đổi mật khẩu sau khi đăng nhập lần đầu!
    role: 'admin',
    full_name: 'System Administrator',
  });

  console.log('[Seed] ✅ Admin account created:');
  console.log('   Username : admin');
  console.log('   Password : Admin@123456  ← Đổi ngay sau khi đăng nhập!');
  console.log('   Role     : admin');
  console.log('   ID       :', admin._id.toString());

  await mongoose.disconnect();
  console.log('[Seed] Done.');
}

seed().catch(err => { console.error('[Seed] Fatal:', err); process.exit(1); });
