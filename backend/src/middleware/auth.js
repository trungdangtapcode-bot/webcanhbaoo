const jwt = require('jsonwebtoken');
const User = require('../models/User');

// ─────────────────────────────────────────────────────────────────────────────
// authMiddleware — Xác thực JWT (dùng cho User login)
// Header: Authorization: Bearer <jwt>
// ─────────────────────────────────────────────────────────────────────────────
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Gắn thông tin user (không có password) vào request
    const user = await User.findById(decoded.id).select('-password');
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'User not found or deactivated' });
    }
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired, please login again' });
    }
    return res.status(403).json({ error: 'Invalid token' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// roleMiddleware — Kiểm tra quyền theo role
// Dùng sau authMiddleware: roleMiddleware('admin') hoặc roleMiddleware('admin','operator')
// ─────────────────────────────────────────────────────────────────────────────
function roleMiddleware(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Required roles: [${allowedRoles.join(', ')}]. Your role: ${req.user.role}`,
      });
    }
    next();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// cameraTokenMiddleware — Xác thực Camera qua API Token (Bearer token)
// Dùng cho endpoint nhận dữ liệu từ AI module (không phải từ User)
// ─────────────────────────────────────────────────────────────────────────────
const Camera = require('../models/Camera');

async function cameraTokenMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Camera API token required' });
  }

  const plainToken = authHeader.split(' ')[1];
  const cameraId = req.body?.camera_id || req.query?.camera_id;

  if (!cameraId) {
    return res.status(400).json({ error: 'camera_id is required' });
  }

  try {
    const camera = await Camera.findOne({ camera_id: cameraId, active: true }).select('+api_token_hash');
    if (!camera) {
      return res.status(404).json({ error: `Camera '${cameraId}' not found or inactive` });
    }

    if (!camera.verifyToken(plainToken)) {
      return res.status(403).json({ error: 'Invalid camera API token' });
    }

    // Update last seen timestamp
    camera.status = 'online';
    camera.last_seen = new Date();
    await camera.save();

    req.camera = camera;
    next();
  } catch (err) {
    console.error('[cameraTokenMiddleware]', err);
    return res.status(500).json({ error: 'Token verification failed' });
  }
}

module.exports = { authMiddleware, roleMiddleware, cameraTokenMiddleware };
