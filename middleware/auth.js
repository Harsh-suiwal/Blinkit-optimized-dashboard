/**
 * Auth middleware – session-based.
 * Protects routes that require login. Permissions: see middleware/access.js.
 */

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  }
  next();
}

// Role checks live in middleware/access.js (requirePerm). Use requireAuth for "logged in" only.
module.exports = { requireAuth };
