const Camera = require('../models/Camera');
const CameraContribution = require('../models/CameraContribution');
const { isDatabaseConnected } = require('../config/database');
const { DEMO_CAMERAS } = require('./cameraController');

const memoryContributions = [];

function cleanString(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function extractYoutubeVideoId(value) {
  const input = cleanString(value, 500);
  if (!input) return null;

  try {
    const url = new URL(input);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') return cleanString(url.pathname.split('/').filter(Boolean)[0], 32);
    if (host.endsWith('youtube.com')) {
      if (url.searchParams.get('v')) return cleanString(url.searchParams.get('v'), 32);
      const parts = url.pathname.split('/').filter(Boolean);
      const markerIndex = parts.findIndex((part) => ['embed', 'shorts', 'live'].includes(part));
      if (markerIndex >= 0 && parts[markerIndex + 1]) return cleanString(parts[markerIndex + 1], 32);
    }
  } catch (_err) {
    return null;
  }

  return null;
}

function getYoutubeThumbnailUrl(value) {
  const videoId = extractYoutubeVideoId(value);
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault_live.jpg` : null;
}

function toBoolean(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'co', 'có'].includes(normalized)) return true;
    if (['false', '0', 'no', 'khong', 'không'].includes(normalized)) return false;
  }
  return fallback;
}

function serialize(item) {
  const plain = typeof item?.toObject === 'function' ? item.toObject() : item;
  return {
    ...plain,
    id: String(plain._id || plain.id),
  };
}

function normalizeContribution(body = {}) {
  const lat = toFiniteNumber(body.lat ?? body.location?.lat);
  const lng = toFiniteNumber(body.lng ?? body.location?.lng);
  const name = cleanString(body.name, 120);

  if (!name || lat === null || lng === null) {
    return { error: 'Missing required fields: name, lat, lng' };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { error: 'Invalid coordinates' };
  }

  return {
    name,
    location: {
      lat,
      lng,
      address: cleanString(body.address ?? body.location?.address, 240),
    },
    stream_url: cleanString(body.stream_url, 500) || null,
    snapshot_url: cleanString(body.snapshot_url, 500)
      || getYoutubeThumbnailUrl(body.stream_url)
      || getYoutubeThumbnailUrl(body.snapshot_url)
      || null,
    note: cleanString(body.note, 500),
    contributor: {
      name: cleanString(body.contributor?.name || body.contributor_name, 120),
      email: cleanString(body.contributor?.email || body.contributor_email, 160),
    },
    privacy: {
      public_visible: toBoolean(body.privacy?.public_visible ?? body.public_visible, true),
      incident_share: toBoolean(body.privacy?.incident_share ?? body.incident_share, true),
    },
    status: 'pending',
    created_at: new Date(),
  };
}

function makeCameraId(contribution) {
  const source = String(contribution._id || contribution.id || Date.now())
    .replace(/[^a-z0-9]/gi, '')
    .slice(-10)
    .toUpperCase();
  return contribution.camera_id || `USER_CAM_${source || Date.now()}`;
}

async function createContribution(req, res) {
  try {
    const contribution = normalizeContribution(req.body);
    if (contribution.error) return res.status(400).json({ error: contribution.error });

    let saved;
    if (isDatabaseConnected()) {
      saved = await CameraContribution.create(contribution);
    } else {
      saved = {
        ...contribution,
        id: `demo_contribution_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      };
      memoryContributions.unshift(saved);
    }

    return res.status(201).json({ success: true, contribution: serialize(saved) });
  } catch (err) {
    console.error('[CameraContribution] create error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getContributions(req, res) {
  try {
    const status = cleanString(req.query.status, 30);
    const filter = status ? { status } : {};

    if (isDatabaseConnected()) {
      const contributions = await CameraContribution.find(filter)
        .sort({ created_at: -1 })
        .limit(500)
        .lean();
      return res.json({ contributions: contributions.map(serialize) });
    }

    return res.json({
      contributions: memoryContributions
        .filter((item) => !status || item.status === status)
        .map(serialize),
      demo: true,
    });
  } catch (err) {
    console.error('[CameraContribution] list error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function reviewContribution(req, res) {
  try {
    const action = cleanString(req.body.action, 30);
    const nextStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : null;
    if (!nextStatus) return res.status(400).json({ error: 'action must be approve or reject' });

    let contribution;
    if (isDatabaseConnected()) {
      contribution = await CameraContribution.findById(req.params.id);
    } else {
      contribution = memoryContributions.find((item) => item.id === req.params.id);
    }
    if (!contribution) return res.status(404).json({ error: 'Contribution not found' });

    const cameraId = makeCameraId(contribution);
    let camera = null;
    const isPublicVisible = contribution.privacy?.public_visible !== false;
    if (nextStatus === 'approved' && isPublicVisible) {
      const cameraPayload = {
        camera_id: cameraId,
        name: contribution.name,
        location: contribution.location,
        max_red_light_time: 90,
        active: true,
        source: 'user_contribution',
        external_id: null,
        stream_type: contribution.snapshot_url ? 'snapshot' : 'proxy',
        stream_url: contribution.stream_url || null,
        snapshot_url: contribution.snapshot_url || null,
        metadata: {
          contribution_id: String(contribution._id || contribution.id),
          contributor: contribution.contributor || {},
          note: contribution.note || '',
          privacy: contribution.privacy || { public_visible: true, incident_share: true },
          snapshot_refresh_ms: 5000,
        },
      };

      if (isDatabaseConnected()) {
        camera = await Camera.findOneAndUpdate(
          { camera_id: cameraId },
          cameraPayload,
          { upsert: true, new: true, runValidators: true }
        ).lean();
      } else {
        camera = cameraPayload;
        const existingIndex = DEMO_CAMERAS.findIndex((item) => item.camera_id === cameraPayload.camera_id);
        if (existingIndex >= 0) {
          DEMO_CAMERAS[existingIndex] = { ...DEMO_CAMERAS[existingIndex], ...cameraPayload };
        } else {
          DEMO_CAMERAS.unshift(cameraPayload);
        }
      }
    }

    const patch = {
      status: nextStatus,
      camera_id: nextStatus === 'approved' && isPublicVisible ? cameraId : contribution.camera_id || null,
      admin_note: cleanString(req.body.admin_note, 500),
      reviewed_at: new Date(),
    };

    if (isDatabaseConnected()) {
      contribution = await CameraContribution.findByIdAndUpdate(req.params.id, patch, { new: true }).lean();
    } else {
      Object.assign(contribution, patch);
    }

    return res.json({ success: true, contribution: serialize(contribution), camera });
  } catch (err) {
    console.error('[CameraContribution] review error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteContribution(req, res) {
  try {
    let contribution;
    if (isDatabaseConnected()) {
      contribution = await CameraContribution.findById(req.params.id).lean();
    } else {
      contribution = memoryContributions.find((item) => item.id === req.params.id);
    }
    if (!contribution) return res.status(404).json({ error: 'Contribution not found' });

    const cameraId = contribution.camera_id;
    let cameraDeleted = false;
    if (cameraId) {
      if (isDatabaseConnected()) {
        const result = await Camera.deleteOne({ camera_id: cameraId, source: 'user_contribution' });
        cameraDeleted = Boolean(result.deletedCount);
      } else {
        const index = DEMO_CAMERAS.findIndex(
          (camera) => camera.camera_id === cameraId && camera.source === 'user_contribution'
        );
        if (index >= 0) {
          DEMO_CAMERAS.splice(index, 1);
          cameraDeleted = true;
        }
      }
    }

    if (isDatabaseConnected()) {
      await CameraContribution.deleteOne({ _id: req.params.id });
    } else {
      const index = memoryContributions.findIndex((item) => item.id === req.params.id);
      if (index >= 0) memoryContributions.splice(index, 1);
    }

    return res.json({ success: true, camera_deleted: cameraDeleted, camera_id: cameraId || null });
  } catch (err) {
    console.error('[CameraContribution] delete error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  createContribution,
  deleteContribution,
  getContributions,
  reviewContribution,
};
