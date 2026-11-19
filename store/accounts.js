/**
 * User accounts.
 *   admin_users (Supabase) : id, email, password (bcrypt), role
 *   kv "userProfiles"      : { "<user id>": { name, brands: ["Brand", ...], active: true|false } }
 * A user with no profile yet counts as active, with no name and no brands.
 *
 * The validators below are plain functions (no Express, no database) so they can be tested on their own.
 */
const kv = require('./kv');
const supabase = require('../db/supabase');
const { getRolePermissions, getRoleLabels } = require('../config/permissions');

const PROFILES_KEY = 'userProfiles';
const SESSION_PREFIX = 'session:';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const MAX_NAME = 80;

function profileOf(userId) {
  const all = kv.peek(PROFILES_KEY, {}) || {};
  const p = all[userId] || {};
  return {
    name: typeof p.name === 'string' ? p.name : '',
    brands: Array.isArray(p.brands) ? p.brands.filter((b) => typeof b === 'string') : [],
    active: p.active !== false,
  };
}

/** Merges `patch` into one user's profile and saves the whole map (one write at a time). */
function saveProfile(userId, patch) {
  return kv.withLock(async () => {
    const all = kv.get(PROFILES_KEY, {}) || {};
    all[userId] = { ...profileOf(userId), ...patch };
    await kv.set(PROFILES_KEY, all);
    return all[userId];
  });
}

/** Ends every login session of one user (after a password reset or deactivation). */
async function endSessionsOf(userId) {
  for (const key of kv.keys()) {
    if (!key.startsWith(SESSION_PREFIX)) continue;
    const row = kv.peek(key, null);
    if (row && row.sess && row.sess.user && row.sess.user.id === userId) await kv.delete(key);
  }
}

/** Roles in the live permission table have a name; a role missing from the table gets no access. Fails closed. */
function isKnownRole(role) {
  if (typeof role !== 'string') return false;
  const roles = getRolePermissions();
  return Object.prototype.hasOwnProperty.call(roles, role);
}

/**
 * One-time start-up step: any account whose role is not in the table (for example the old "viewer")
 * becomes Ecom executive, which sees no brand until an admin ticks one. Returns how many were changed.
 */
async function migrateUnknownRoles() {
  const { data, error } = await supabase.from('admin_users').select('id, role');
  if (error) throw new Error(`role check failed: ${error.message}`);
  let changed = 0;
  for (const row of data || []) {
    if (isKnownRole(row.role)) continue;
    const { error: updateError } = await supabase.from('admin_users').update({ role: 'ecom_executive' }).eq('id', row.id);
    if (updateError) throw new Error(`role update failed: ${updateError.message}`);
    changed += 1;
  }
  return changed;
}

// --- Validation (pure) ---------------------------------------------------------

/** Trims a text field; returns { value } or { error }. */
function cleanText(value, field, max) {
  if (value === undefined || value === null) return { value: '' };
  if (typeof value !== 'string') return { error: `${field} must be text.` };
  const trimmed = value.trim();
  if (trimmed.length > max) return { error: `${field} must be ${max} characters or fewer.` };
  return { value: trimmed };
}

/**
 * Brand ticks must be names the app already knows. Matching ignores case; the stored name is the
 * canonical spelling from `knownBrands`. Returns { value: [names] } or { error }.
 */
function cleanBrands(list, knownBrands) {
  if (list === undefined || list === null) return { value: [] };
  if (!Array.isArray(list) || list.some((b) => typeof b !== 'string')) return { error: 'brands must be a list of brand names.' };
  const byKey = new Map(knownBrands.map((b) => [b.toLowerCase(), b]));
  const out = [];
  for (const raw of list) {
    const canonical = byKey.get(raw.trim().toLowerCase());
    if (!canonical) return { error: 'One of the brands is not a known brand.' };
    if (!out.includes(canonical)) out.push(canonical);
  }
  return { value: out };
}

function cleanRole(role) {
  if (!isKnownRole(role)) return { error: 'Choose a role from the list.' };
  return { value: role };
}

/** Input for creating a user: email, password, role are required. Returns { value } or { error }. */
function validateNewUser(input, knownBrands) {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!email || email.length > 200 || !EMAIL_RE.test(email)) return { error: 'Enter a valid email address.' };
  if (typeof input.password !== 'string' || input.password.length < MIN_PASSWORD) {
    return { error: `Password must be at least ${MIN_PASSWORD} characters.` };
  }
  const name = cleanText(input.name, 'Name', MAX_NAME);
  if (name.error) return name;
  const role = cleanRole(input.role);
  if (role.error) return role;
  const brands = cleanBrands(input.brands, knownBrands);
  if (brands.error) return brands;
  if (input.active !== undefined && typeof input.active !== 'boolean') return { error: 'active must be true or false.' };
  return {
    value: { email, password: input.password, name: name.value, role: role.value, brands: brands.value, active: input.active !== false },
  };
}

/** Input for editing a user: only the fields sent are checked and returned. Returns { value } or { error }. */
function validateUserPatch(input, knownBrands) {
  const value = {};
  if (input.name !== undefined) {
    const name = cleanText(input.name, 'Name', MAX_NAME);
    if (name.error) return name;
    value.name = name.value;
  }
  if (input.role !== undefined) {
    const role = cleanRole(input.role);
    if (role.error) return role;
    value.role = role.value;
  }
  if (input.brands !== undefined) {
    const brands = cleanBrands(input.brands, knownBrands);
    if (brands.error) return brands;
    value.brands = brands.value;
  }
  if (input.active !== undefined) {
    if (typeof input.active !== 'boolean') return { error: 'active must be true or false.' };
    value.active = input.active;
  }
  return { value };
}

/** Input for a new password (an admin sets or resets it). Returns { value } or { error }. */
function validatePassword(input) {
  if (!input || typeof input.password !== 'string' || input.password.length < MIN_PASSWORD) {
    return { error: `Password must be at least ${MIN_PASSWORD} characters.` };
  }
  return { value: input.password };
}

/**
 * True when the change would leave no active admin. `users` = [{ id, role, active }].
 * Demoting the last active admin or deactivating them is refused; removing the admin role from one of
 * several admins is fine.
 */
function lastActiveAdminBlocked(users, userId, nextRole, nextActive) {
  const current = users.find((u) => u.id === userId);
  if (!current) return false;
  const wasActiveAdmin = current.role === 'admin' && current.active;
  const willBeActiveAdmin = nextRole === 'admin' && nextActive;
  if (!wasActiveAdmin || willBeActiveAdmin) return false;
  return !users.some((u) => u.id !== userId && u.role === 'admin' && u.active);
}

/** The role list for the Users page: [{ value, label }]. */
function roleOptions() {
  const roles = getRolePermissions();
  const labels = getRoleLabels();
  return Object.keys(roles).map((value) => ({ value, label: labels[value] || value }));
}

module.exports = {
  profileOf,
  saveProfile,
  endSessionsOf,
  migrateUnknownRoles,
  isKnownRole,
  validateNewUser,
  validateUserPatch,
  validatePassword,
  lastActiveAdminBlocked,
  roleOptions,
  MIN_PASSWORD,
};
