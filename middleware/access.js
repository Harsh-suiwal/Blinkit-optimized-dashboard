/**
 * Who may do what, checked on every /api request.
 *
 *  - loadAccount: reads the user's role (admin_users) and profile (kv) on EVERY call, so a change made by an
 *    admin applies on that user's next click. A deactivated user gets 401 at once.
 *  - brandGuard: a user without allBrands may only ask for a brand they were ticked for. Any other brand
 *    gets the same "Not found." as a brand that does not exist, so no other brand name, count or error leaks.
 *    Every JSON answer is also cleaned so it lists only the user's own brands.
 *  - requirePerm(key): one permission from config/permissions.js.
 *
 * The decision functions are pure (no Express) so scripts/access-smoke.js can test them.
 */
const { ROLES, ROLE_LABELS, PERM_KEYS } = require('../config/permissions');
const supabase = require('../db/supabase');
const accounts = require('../store/accounts');

// Brand-free lists that filter their own answer (see scrubForAccount). They need no brand parameter.
const BRAND_FREE_ROUTES = new Set(['/api/brand-names', '/api/campaign-brands']);

const NO_ACCESS = Object.fromEntries(PERM_KEYS.map((k) => [k, false]));

/** The permissions a role has. Uploads also need allBrands. Unknown roles get nothing. */
function permsFor(role) {
  const base = Object.prototype.hasOwnProperty.call(ROLES, role) ? { ...NO_ACCESS, ...ROLES[role] } : { ...NO_ACCESS };
  base.upload = Boolean(base.upload && base.allBrands);
  return base;
}

function sameName(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function accountFrom(row, profile) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    name: profile.name,
    brands: profile.brands,
    perms: permsFor(row.role),
  };
}

/** Looks a user up again: the role and brands come from storage, not from the session. */
async function resolveAccount(userId) {
  const { data: row, error } = await supabase.from('admin_users').select('id, email, role').eq('id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null;
  const profile = accounts.profileOf(row.id);
  if (!profile.active) return null;
  return accountFrom(row, profile);
}

/** What the browser may see about the user (no password, no internal fields). */
function publicAccount(account) {
  return {
    email: account.email,
    role: account.role,
    roleLabel: ROLE_LABELS[account.role] || account.role,
    name: account.name,
    brands: account.perms.allBrands ? null : account.brands, // null = every brand
    perms: account.perms,
  };
}

/** Does this account see this brand? */
function canSeeBrand(account, brand) {
  if (!account) return false;
  if (account.perms.allBrands) return true;
  return account.brands.some((b) => sameName(b, brand));
}

/**
 * The reason to refuse a request on brand grounds, or null when it may go on.
 * `req` needs: path, query, body.
 */
function brandDecision(account, req) {
  if (account.perms.allBrands) return null;
  if (BRAND_FREE_ROUTES.has(req.path) || req.path.startsWith('/api/users')) return null;
  if (!account.brands.length) return { status: 403, error: 'No brand is assigned to your account. Ask an admin.' };

  const values = [req.query && req.query.brand, req.body && req.body.brand].filter((v) => v !== undefined);
  if (!values.length) return { status: 400, error: 'Choose a brand first.' };
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) return { status: 400, error: 'Choose a brand first.' };
    if (!canSeeBrand(account, value)) return { status: 404, error: 'Not found.' };
  }
  return null;
}

const LIST_KEYS = new Set(['brands', 'allBrands', 'brandSummaries']);

/**
 * Removes other brands from an answer: brandUploads (keyed by brand), and lists of brands or brand
 * summaries. Returns a new value; the input is not changed.
 */
function scrubForAccount(value, account, depth = 0) {
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => scrubForAccount(item, account, depth + 1));
  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    if (key === 'brandUploads' && inner && typeof inner === 'object' && !Array.isArray(inner)) {
      out[key] = Object.fromEntries(Object.entries(inner).filter(([brand]) => canSeeBrand(account, brand)));
    } else if (LIST_KEYS.has(key) && Array.isArray(inner)) {
      out[key] = inner
        .filter((item) => canSeeBrand(account, typeof item === 'string' ? item : item && item.brandName))
        .map((item) => scrubForAccount(item, account, depth + 1));
    } else {
      out[key] = scrubForAccount(inner, account, depth + 1);
    }
  }
  return out;
}

// --- Express middleware --------------------------------------------------------

/** Loads the account for every /api call. Requests without a session pass on (requireAuth answers them). */
async function loadAccount(req, res, next) {
  if (!req.path.startsWith('/api/') || !req.session || !req.session.user) return next();
  try {
    const account = await resolveAccount(req.session.user.id);
    if (!account) return res.status(401).json({ error: 'Not authenticated. Please log in.' });
    req.account = account;
    req.session.user.role = account.role; // display only: every check reads req.account
    return next();
  } catch (err) {
    console.error('Account lookup failed:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

/** Applies the brand rules and cleans every JSON answer for accounts without allBrands. */
function brandGuard(req, res, next) {
  const account = req.account;
  if (!account || !req.path.startsWith('/api/')) return next();
  if (!account.perms.allBrands) {
    const sendJson = res.json.bind(res);
    res.json = (body) => sendJson(scrubForAccount(body, account));
  }
  const denied = brandDecision(account, req);
  if (denied) return res.status(denied.status).json({ error: denied.error });
  return next();
}

/** Lets through only accounts whose role has this permission. */
function requirePerm(key) {
  return (req, res, next) => {
    if (!req.account) return res.status(401).json({ error: 'Not authenticated. Please log in.' });
    if (!req.account.perms[key]) return res.status(403).json({ error: 'Not available for your role.' });
    return next();
  };
}

module.exports = {
  permsFor,
  accountFrom,
  resolveAccount,
  publicAccount,
  canSeeBrand,
  brandDecision,
  scrubForAccount,
  loadAccount,
  brandGuard,
  requirePerm,
};
