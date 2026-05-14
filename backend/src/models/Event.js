const mongoose = require('mongoose');

// ── Alert Level: 1 = Info | 2 = Warning | 3 = Critical ─────────────────────
const LEVEL_MAP = {
  traffic_jam: 1, // Thông tin
  flood: 2,       // Cảnh báo
  fire: 3,        // Khẩn cấp
};

const eventSchema = new mongoose.Schema(
  {
    camera_id: {
      type: String,
      required: true,
      index: true,
    },
    // Reference to Camera doc (optional but allows populate)
    camera_ref: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Camera',
      default: null,
    },
    event_type: {
      type: String,
      required: true,
      enum: ['traffic_jam', 'fire', 'flood'],
      index: true,
    },
    // ── Phân cấp cảnh báo: 1-Thông tin | 2-Cảnh báo | 3-Khẩn cấp ──────────
    level: {
      type: Number,
      enum: [1, 2, 3],
      default: function () {
        return LEVEL_MAP[this.event_type] || 2;
      },
      index: true,
    },
    // ── Vị trí xảy ra sự cố ─────────────────────────────────────────────────
    location: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      address: { type: String, default: '' },
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0,
    },
    // ── Lưu URL tĩnh thay vì Base64 để tối ưu DB ─────────────────────────────
    // Ví dụ: '/uploads/events/2025-01-14_fire_001.jpg'
    image_url: {
      type: String,
      default: null,
    },
    // Metadata linh hoạt: vehicle_count, water_ratio, avg_speed, v.v.
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // Đã được xử lý / xác nhận bởi operator chưa
    is_resolved: {
      type: Boolean,
      default: false,
      index: true,
    },
    resolved_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    resolved_at: {
      type: Date,
      default: null,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

// ── Compound indexes để tối ưu query lịch sử ─────────────────────────────────
eventSchema.index({ camera_id: 1, timestamp: -1 });
eventSchema.index({ event_type: 1, timestamp: -1 });
eventSchema.index({ level: 1, timestamp: -1 });
eventSchema.index({ timestamp: -1 }); // General time-range queries

// ── Expose LEVEL_MAP cho các module khác ─────────────────────────────────────
eventSchema.statics.LEVEL_MAP = LEVEL_MAP;

module.exports = mongoose.model('Event', eventSchema);
