// Authentication Middleware
const authService = require('../services/authService');

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  const decoded = authService.verifyAccessToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired access token' });
  }

  req.user = decoded;
  next();
}

// Optional auth - doesn't fail if no token, but adds user if present
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    const decoded = authService.verifyAccessToken(token);
    if (decoded) {
      req.user = decoded;
    }
  }

  next();
}

// Rate limiting for auth endpoints
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes

function rateLimitLogin(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const key = `${ip}:${req.body.email || ''}`;

  const attempts = loginAttempts.get(key);

  if (attempts && attempts.count >= MAX_ATTEMPTS) {
    const timeLeft = attempts.lockedUntil - Date.now();
    if (timeLeft > 0) {
      return res.status(429).json({
        error: 'Too many login attempts',
        retryAfter: Math.ceil(timeLeft / 1000),
      });
    }
    // Lockout expired, reset
    loginAttempts.delete(key);
  }

  next();
}

function recordFailedLogin(req) {
  const ip = req.ip || req.connection.remoteAddress;
  const key = `${ip}:${req.body.email || ''}`;

  const attempts = loginAttempts.get(key) || { count: 0 };
  attempts.count += 1;

  if (attempts.count >= MAX_ATTEMPTS) {
    attempts.lockedUntil = Date.now() + LOCKOUT_TIME;
  }

  loginAttempts.set(key, attempts);
}

function clearLoginAttempts(req) {
  const ip = req.ip || req.connection.remoteAddress;
  const key = `${ip}:${req.body.email || ''}`;
  loginAttempts.delete(key);
}

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of loginAttempts.entries()) {
    if (value.lockedUntil && value.lockedUntil < now) {
      loginAttempts.delete(key);
    }
  }
}, 60000); // Every minute

module.exports = {
  authenticateToken,
  optionalAuth,
  rateLimitLogin,
  recordFailedLogin,
  clearLoginAttempts,
};
