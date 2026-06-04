const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { isDatabaseConnected } = require('../config/database');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

function signUserToken(user) {
  return jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/register
// Admin tạo tài khoản mới (chỉ admin mới được tạo)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/register', authMiddleware, roleMiddleware('admin'), async (req, res) => {
  try {
    if (!isDatabaseConnected()) {
      return res.status(503).json({ error: 'Database not connected. Running in demo mode.' });
    }

    const { username, email, password, role, full_name } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'username, email, and password are required' });
    }

    const existing = await User.findOne({ $or: [{ username }, { email }] });
    if (existing) {
      return res.status(409).json({ error: 'Username or email already exists' });
    }

    const user = await User.create({ username, email, password, role, full_name });

    res.status(201).json({
      message: 'User created successfully',
      user: user.toSafeObject(),
    });
  } catch (err) {
    console.error('[Auth] Register error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/signup
// Public — người dùng tự đăng kí tài khoản operator
// ─────────────────────────────────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  try {
    if (!isDatabaseConnected()) {
      return res.status(503).json({ error: 'Database not connected. Running in demo mode.' });
    }

    const { username, email, password, full_name } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'username, email, and password are required' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const cleanEmail = email.trim().toLowerCase();

    const existing = await User.findOne({ $or: [{ username: cleanUsername }, { email: cleanEmail }] });
    if (existing) {
      return res.status(409).json({ error: 'Username or email already exists' });
    }

    const user = await User.create({
      username: cleanUsername,
      email: cleanEmail,
      password,
      full_name,
      role: 'operator',
      last_login: new Date(),
    });

    const token = signUserToken(user);

    res.status(201).json({
      message: 'Signup successful',
      token,
      expires_in: process.env.JWT_EXPIRES_IN || '24h',
      user: user.toSafeObject(),
    });
  } catch (err) {
    console.error('[Auth] Signup error:', err);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(err.errors).map(e => e.message).join(', ') });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/login
// Public — Đăng nhập, trả về JWT
// ─────────────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    if (!isDatabaseConnected()) {
      return res.status(503).json({ error: 'Database not connected. Running in demo mode.' });
    }

    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }

    // Lấy password vì mặc định select: false
    const user = await User.findOne({
      $or: [{ username }, { email: username }], // Cho phép đăng nhập bằng email hoặc username
      is_active: true,
    }).select('+password');

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Cập nhật last_login
    user.last_login = new Date();
    await user.save({ validateBeforeSave: false });

    const token = signUserToken(user);

    res.json({
      message: 'Login successful',
      token,
      expires_in: process.env.JWT_EXPIRES_IN || '24h',
      user: user.toSafeObject(),
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/me
// Lấy thông tin user đang đăng nhập
// ─────────────────────────────────────────────────────────────────────────────
router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user.toSafeObject() });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/users (admin only)
// Liệt kê tất cả users
// ─────────────────────────────────────────────────────────────────────────────
router.get('/users', authMiddleware, roleMiddleware('admin'), async (req, res) => {
  try {
    if (!isDatabaseConnected()) {
      return res.status(503).json({ error: 'Database not connected. Running in demo mode.' });
    }

    const users = await User.find({}).select('-password').sort({ createdAt: -1 });
    res.json({ total: users.length, users });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/auth/users/:id (admin only)
// Cập nhật role hoặc trạng thái active của user
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/users/:id', authMiddleware, roleMiddleware('admin'), async (req, res) => {
  try {
    if (!isDatabaseConnected()) {
      return res.status(503).json({ error: 'Database not connected. Running in demo mode.' });
    }

    const { role, is_active, full_name } = req.body;
    const updates = {};
    if (role !== undefined) updates.role = role;
    if (is_active !== undefined) updates.is_active = is_active;
    if (full_name !== undefined) updates.full_name = full_name;

    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({ message: 'User updated', user: user.toSafeObject() });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
