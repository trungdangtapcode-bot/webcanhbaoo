const mongoose = require('mongoose');

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
      required: true,
      trim: true,
    },
    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
      address: { type: String, default: '' },
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
    token_hash: {
      type: String,
      default: null,
    },
    created_at: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

module.exports = mongoose.model('Camera', cameraSchema);
