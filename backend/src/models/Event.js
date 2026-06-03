const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema(
  {
    camera_id: {
      type: String,
      required: true,
      index: true,
    },
    event_type: {
      type: String,
      required: true,
      enum: ['traffic_jam', 'fire', 'flood'],
    },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
    },
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    image_base64: {
      type: String,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

// Compound index for efficient camera+time queries
eventSchema.index({ camera_id: 1, timestamp: -1 });

module.exports = mongoose.model('Event', eventSchema);
