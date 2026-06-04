const mongoose = require('mongoose');

const cameraContributionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
      address: { type: String, default: '', trim: true },
    },
    stream_url: {
      type: String,
      default: null,
      trim: true,
    },
    snapshot_url: {
      type: String,
      default: null,
      trim: true,
    },
    note: {
      type: String,
      default: '',
      trim: true,
    },
    contributor: {
      name: { type: String, default: '', trim: true },
      email: { type: String, default: '', trim: true },
    },
    privacy: {
      public_visible: { type: Boolean, default: true },
      incident_share: { type: Boolean, default: true },
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    camera_id: {
      type: String,
      default: null,
      trim: true,
    },
    admin_note: {
      type: String,
      default: '',
      trim: true,
    },
    reviewed_at: {
      type: Date,
      default: null,
    },
    created_at: {
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

module.exports = mongoose.model('CameraContribution', cameraContributionSchema);
