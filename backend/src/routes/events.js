const express = require('express');
const router = express.Router();
const Event = require('../models/Event');
const { authMiddleware, roleMiddleware, cameraTokenMiddleware } = require('../middleware/auth');
const alertService = require('../services/alertService');

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/events — AI module gửi sự kiện lên
// Xác thực bằng Camera API Token (không phải User JWT)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', cameraTokenMiddleware, async (req, res) => {
  try {
    const {
      camera_id, event_type, confidence, lat, lng, address,
      image_base64, // Nhận base64 từ AI nhưng sẽ xử lý riêng (lưu file rồi gán URL)
      timestamp, metadata,
      vehicle_count, avg_speed, water_ratio, // Shorthand metadata fields
    } = req.body;

    // Xác định level tự động theo event_type nếu không gửi lên
    const LEVEL_MAP = { fire: 3, flood: 2, traffic_jam: 1 };
    const level = req.body.level || LEVEL_MAP[event_type] || 2;

    // --- Lưu ảnh (TODO: tích hợp multer/S3 sau) ---
    // Hiện tại bỏ qua base64 để tối ưu DB, chỉ lưu placeholder
    let image_url = null;
    if (image_base64) {
      // TODO: Decode và lưu vào /uploads hoặc S3, rồi gán đường dẫn
      // image_url = await saveBase64Image(image_base64, event_type);
      image_url = null; // Tạm để null cho tới khi tích hợp file storage
    }

    const combinedMetadata = {
      ...metadata,
      ...(vehicle_count !== undefined && { vehicle_count }),
      ...(avg_speed !== undefined && { avg_speed }),
      ...(water_ratio !== undefined && { water_ratio }),
    };

    const event = await Event.create({
      camera_id,
      camera_ref: req.camera?._id,
      event_type,
      level,
      confidence: confidence || 0,
      location: {
        lat: lat || req.camera?.location?.lat || null,
        lng: lng || req.camera?.location?.lng || null,
        address: address || req.camera?.location?.address || '',
      },
      image_url,
      metadata: combinedMetadata,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
    });

    // Broadcast real-time qua Socket.IO
    const payload = {
      _id: event._id,
      camera_id: event.camera_id,
      event_type: event.event_type,
      type: event.event_type, // alias cho frontend
      level: event.level,
      confidence: event.confidence,
      lat: event.location.lat,
      lng: event.location.lng,
      location: event.location.address,
      address: event.location.address,
      metadata: event.metadata,
      timestamp: event.timestamp,
    };
    alertService.broadcast('alert', payload);
    alertService.broadcast('new-event', payload);

    res.status(201).json({ success: true, event_id: event._id });
  } catch (err) {
    console.error('[Events] Create error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/events — Lấy sự kiện gần đây (public, cho dashboard)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const events = await Event.find({})
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    // Chuẩn hóa fields cho frontend
    const normalized = events.map(e => ({
      ...e,
      type: e.event_type,
      lat: e.location?.lat,
      lng: e.location?.lng,
      address: e.location?.address,
    }));

    res.json(normalized);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/events/stats — Thống kê tổng hợp (cho biểu đồ Dashboard)
// Query: ?days=7 (mặc định 7 ngày gần nhất)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 7));
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

    const [byType, byDay, byLevel, summary, byCam] = await Promise.all([
      // Tổng theo loại sự kiện
      Event.aggregate([
        { $match: { timestamp: { $gte: from } } },
        { $group: { _id: '$event_type', count: { $sum: 1 } } },
      ]),
      // Theo ngày + loại (cho line/bar chart)
      Event.aggregate([
        { $match: { timestamp: { $gte: from } } },
        {
          $group: {
            _id: {
              day: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp', timezone: '+07:00' } },
              type: '$event_type',
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.day': 1 } },
      ]),
      // Theo level
      Event.aggregate([
        { $match: { timestamp: { $gte: from } } },
        { $group: { _id: '$level', count: { $sum: 1 } } },
      ]),
      // KPI summary
      Event.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            unresolved: { $sum: { $cond: ['$is_resolved', 0, 1] } },
            today: { $sum: { $cond: [{ $gte: ['$timestamp', todayStart] }, 1, 0] } },
            critical: { $sum: { $cond: [{ $eq: ['$level', 3] }, 1, 0] } },
          },
        },
      ]),
      // Top cameras có nhiều sự cố nhất
      Event.aggregate([
        { $match: { timestamp: { $gte: from } } },
        { $group: { _id: '$camera_id', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]),
    ]);

    res.json({
      period_days: days,
      summary: summary[0] || { total: 0, unresolved: 0, today: 0, critical: 0 },
      by_type: byType,
      by_day: byDay,
      by_level: byLevel,
      top_cameras: byCam,
    });
  } catch (err) {
    console.error('[Events] Stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/events/history — Lọc lịch sử sự kiện nâng cao
// Query params:
//   from, to       — ISO date strings (e.g. 2025-01-01T00:00:00Z)
//   type           — fire | flood | traffic_jam (comma-separated)
//   level          — 1 | 2 | 3 (comma-separated)
//   camera_id      — filter theo camera
//   is_resolved    — true | false
//   page, limit    — Pagination
// ─────────────────────────────────────────────────────────────────────────────
router.get('/history', async (req, res) => {
  try {
    const {
      from, to,
      type, level,
      camera_id,
      is_resolved,
      page = 1,
      limit = 50,
      sort = '-timestamp',
    } = req.query;

    const filter = {};

    // ── Lọc thời gian ─────────────────────────────────────────────────────
    if (from || to) {
      filter.timestamp = {};
      if (from) filter.timestamp.$gte = new Date(from);
      if (to)   filter.timestamp.$lte = new Date(to);
    }

    // ── Lọc loại sự kiện (cho phép nhiều loại: type=fire,flood) ──────────
    if (type) {
      const types = type.split(',').map(t => t.trim()).filter(Boolean);
      filter.event_type = types.length === 1 ? types[0] : { $in: types };
    }

    // ── Lọc mức độ cảnh báo (level=2,3) ──────────────────────────────────
    if (level) {
      const levels = level.split(',').map(l => parseInt(l)).filter(n => !isNaN(n));
      filter.level = levels.length === 1 ? levels[0] : { $in: levels };
    }

    // ── Lọc theo camera ───────────────────────────────────────────────────
    if (camera_id) filter.camera_id = camera_id;

    // ── Lọc trạng thái xử lý ─────────────────────────────────────────────
    if (is_resolved !== undefined) {
      filter.is_resolved = is_resolved === 'true';
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [events, total] = await Promise.all([
      Event.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .populate('resolved_by', 'username full_name')
        .lean(),
      Event.countDocuments(filter),
    ]);

    res.json({
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil(total / limitNum),
      events,
    });
  } catch (err) {
    console.error('[Events] History error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/events/:id/resolve — Đánh dấu sự kiện đã được xử lý (operator+)
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/resolve', authMiddleware, roleMiddleware('admin', 'operator'), async (req, res) => {
  try {
    const event = await Event.findByIdAndUpdate(
      req.params.id,
      {
        is_resolved: true,
        resolved_by: req.user._id,
        resolved_at: new Date(),
      },
      { new: true }
    ).populate('resolved_by', 'username full_name');

    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json({ message: 'Event marked as resolved', event });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/events — Xóa toàn bộ (admin only, dùng khi test)
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/', authMiddleware, roleMiddleware('admin'), async (req, res) => {
  try {
    const result = await Event.deleteMany({});
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
