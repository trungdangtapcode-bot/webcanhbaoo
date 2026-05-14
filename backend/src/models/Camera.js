const mongoose = require('mongoose');
const crypto = require('crypto');

const cameraSchema = new mongoose.Schema(
  {
    camera_id: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Camera name is required'],
      trim: true,
    },
    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
      address: { type: String, default: '' },
    },
    status: {
      type: String,
      enum: ['online', 'offline', 'maintenance'],
      default: 'offline',
      index: true,
    },
    last_seen: {
      type: Date,
      default: null,
    },
    // Hashed token — camera gửi lên plain token, ta so sánh với hash này
    api_token_hash: {
      type: String,
      default: null,
      select: false, // Không trả về hash raw trong query
    },
    max_red_light_time: {
      type: Number,
      default: 90,
      min: 10,
    },
    active: {
      type: Boolean,
      default: true,
    },
    // Người tạo/quản lý camera
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// ── Static method: Generate a random API token and return [plainToken, hash] ──
cameraSchema.statics.generateApiToken = function () {
  const plainToken = crypto.randomBytes(32).toString('hex'); // 64-char hex
  const hash = crypto.createHash('sha256').update(plainToken).digest('hex');
  return { plainToken, hash };
};

// ── Instance method: Verify an incoming plain token ──────────────────────────
cameraSchema.methods.verifyToken = function (plainToken) {
  const hash = crypto.createHash('sha256').update(plainToken).digest('hex');
  return hash === this.api_token_hash;
};

module.exports = mongoose.model('Camera', cameraSchema);
