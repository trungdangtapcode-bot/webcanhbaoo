const express = require('express');
const router = express.Router();
const Camera = require('../models/Camera');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cameras — Lấy danh sách camera
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status, active } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (active !== undefined) filter.active = active === 'true';

    const cameras = await Camera.find(filter)
      .populate('created_by', 'username full_name')
      .sort({ createdAt: -1 });

    res.json({ total: cameras.length, cameras });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cameras/:id — Lấy chi tiết 1 camera
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const camera = await Camera.findOne({ camera_id: req.params.id })
      .populate('created_by', 'username full_name');
    if (!camera) return res.status(404).json({ error: 'Camera not found' });
    res.json(camera);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cameras — Tạo camera mới (admin only)
// Response trả về plainToken một lần duy nhất, sau đó không thể xem lại
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', authMiddleware, roleMiddleware('admin'), async (req, res) => {
  try {
    const { camera_id, name, location, max_red_light_time } = req.body;

    if (!camera_id || !name || !location?.lat || !location?.lng) {
      return res.status(400).json({ error: 'camera_id, name, location.lat, location.lng are required' });
    }

    const existing = await Camera.findOne({ camera_id });
    if (existing) return res.status(409).json({ error: `Camera '${camera_id}' already exists` });

    // Tạo API token
    const { plainToken, hash } = Camera.generateApiToken();

    const camera = await Camera.create({
      camera_id,
      name,
      location,
      max_red_light_time,
      api_token_hash: hash,
      created_by: req.user._id,
    });

    // Trả về plainToken một lần duy nhất để cấu hình vào .env của AI module
    res.status(201).json({
      message: 'Camera created. Save the api_token now — it will NOT be shown again.',
      camera_id: camera.camera_id,
      api_token: plainToken, // ⚠️ Chỉ hiển thị 1 lần
      camera,
    });
  } catch (err) {
    console.error('[Cameras] Create error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/cameras/:id — Cập nhật thông tin camera (admin only)
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id', authMiddleware, roleMiddleware('admin'), async (req, res) => {
  try {
    const { name, location, status, active, max_red_light_time } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (location !== undefined) updates.location = location;
    if (status !== undefined) updates.status = status;
    if (active !== undefined) updates.active = active;
    if (max_red_light_time !== undefined) updates.max_red_light_time = max_red_light_time;

    const camera = await Camera.findOneAndUpdate(
      { camera_id: req.params.id },
      updates,
      { new: true, runValidators: true }
    );
    if (!camera) return res.status(404).json({ error: 'Camera not found' });

    res.json({ message: 'Camera updated', camera });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cameras/:id/regenerate-token — Cấp lại API token (admin only)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/regenerate-token', authMiddleware, roleMiddleware('admin'), async (req, res) => {
  try {
    const { plainToken, hash } = Camera.generateApiToken();
    const camera = await Camera.findOneAndUpdate(
      { camera_id: req.params.id },
      { api_token_hash: hash },
      { new: true }
    );
    if (!camera) return res.status(404).json({ error: 'Camera not found' });

    res.json({
      message: 'API token regenerated. Save the new token now — it will NOT be shown again.',
      camera_id: camera.camera_id,
      api_token: plainToken,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/cameras/:id — Xóa camera (admin only)
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, roleMiddleware('admin'), async (req, res) => {
  try {
    const camera = await Camera.findOneAndDelete({ camera_id: req.params.id });
    if (!camera) return res.status(404).json({ error: 'Camera not found' });
    res.json({ message: `Camera '${req.params.id}' deleted successfully` });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
