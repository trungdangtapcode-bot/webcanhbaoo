const mongoose = require('mongoose');

const alertQueueItemSchema = new mongoose.Schema(
  {
    camera_id: {
      type: String,
      required: true,
      index: true,
    },
    camera_name: {
      type: String,
      default: '',
    },
    confidence: {
      type: Number,
      default: null,
    },
    event_type: {
      type: String,
      required: true,
      enum: ['traffic_jam', 'fire', 'flood'],
      index: true,
    },
    first_seen: {
      type: Date,
      default: Date.now,
    },
    last_seen: {
      type: Date,
      default: Date.now,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
    },
    status: {
      type: String,
      enum: ['new', 'in_progress', 'confirmed', 'false_alarm', 'resolved'],
      default: 'new',
      index: true,
    },
    assignee: {
      type: String,
      default: null,
    },
    note: {
      type: String,
      default: '',
    },
    updated_at: {
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

alertQueueItemSchema.index({ camera_id: 1, event_type: 1 }, { unique: true });

module.exports = mongoose.model('AlertQueueItem', alertQueueItemSchema);
