/**
 * Role permissions: ONE true/false table. The server (middleware/access.js) and the pages both read it.
 * Defaults live here; admin edits and custom roles are persisted in kv_store ('rolePermissions') via the
 * Users & Permissions page and take effect on each user's next request without editing this file.
 *
 *   allBrands    sees every brand. false = only the brands ticked for the user; they never learn other brands exist.
 *   profit       sees profit figures (Profit tab, profit lines in product and report views).
 *   upload       uploads reports. Also needs allBrands (enforced in middleware/access.js and on save).
 *   deleteData   deletes stored data (stock, sales, monthly sales, campaigns, a brand).
 *   download     downloads Excel exports.
 *   manageUsers  the Users page: create users, set passwords, roles, brand ticks, active flag, role permissions.
 * A role name that is not in this table gets no access at all (fails closed).
 */
const kv = require('../store/kv');

const ROLE_PERMISSIONS_KEY = 'rolePermissions';

const ROLES = {
  admin:          { allBrands: true,  profit: true,  upload: true,  deleteData: true,  download: true, manageUsers: true  },
  moderator:      { allBrands: true,  profit: true,  upload: true,  deleteData: false, download: true, manageUsers: false },
  ecom_manager:   { allBrands: false, profit: true,  upload: false, deleteData: false, download: true, manageUsers: false },
  ecom_executive: { allBrands: false, profit: false, upload: false, deleteData: false, download: true, manageUsers: false },
};

const ROLE_LABELS = {
  admin: 'Admin',
  moderator: 'Moderator',
  ecom_manager: 'Ecom manager',
  ecom_executive: 'Ecom executive',
};

const BUILT_IN_ROLES = Object.keys(ROLES);
const ROLE_KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

const PERM_KEYS = ['allBrands', 'profit', 'upload', 'deleteData', 'download', 'manageUsers'];

const PERM_META = [
  { key: 'allBrands',   label: 'All brands',       description: 'See every brand; when off, restricted to ticked brands only.' },
  { key: 'profit',      label: 'View profit',      description: 'See profit figures, margins, and cost tabs.' },
  { key: 'upload',      label: 'Upload reports',   description: 'Upload stock, sales, campaign, and cost files (requires All brands).' },
  { key: 'deleteData',  label: 'Delete data',      description: 'Delete stored stock, sales, monthly, or campaign data.' },
  { key: 'download',    label: 'Download exports', description: 'Export Excel workbooks.' },
  { key: 'manageUsers', label: 'Manage users',     description: 'Access Users page, manage accounts, and edit role permissions.' },
];

function readStore() {
  const raw = typeof kv.get === 'function' ? kv.get(ROLE_PERMISSIONS_KEY) : null;
  if (!raw || typeof raw !== 'object') return { permissions: {}, labels: {} };
  // Supports both { permissions, labels } and legacy flat { admin: {...}, ... }
  if (raw.permissions && typeof raw.permissions === 'object') {
    return {
      permissions: raw.permissions,
      labels: raw.labels && typeof raw.labels === 'object' ? raw.labels : {},
    };
  }
  return { permissions: raw, labels: {} };
}

function normalizeRolePerms(role, raw) {
  const defaults = ROLES[role] || {};
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const key of PERM_KEYS) {
    out[key] = typeof source[key] === 'boolean' ? source[key] : Boolean(defaults[key]);
  }
  out.upload = Boolean(out.upload && out.allBrands);
  if (role === 'admin') out.manageUsers = true;
  return out;
}

/** Current role-permission table (built-in + custom roles merged with persisted overrides). */
function getRolePermissions() {
  const { permissions } = readStore();
  const out = {};
  const keys = Array.from(new Set([...BUILT_IN_ROLES, ...Object.keys(permissions)]));
  for (const role of keys) {
    if (!ROLE_KEY_RE.test(role)) continue;
    out[role] = normalizeRolePerms(role, permissions[role]);
  }
  return out;
}

/** Display labels for all built-in + custom roles. */
function getRoleLabels() {
  const { labels } = readStore();
  const perms = getRolePermissions();
  const out = {};
  for (const role of Object.keys(perms)) {
    out[role] = ROLE_LABELS[role] || (typeof labels[role] === 'string' && labels[role].trim()) || role;
  }
  return out;
}

function slugifyRoleKey(label) {
  const slug = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  if (!slug) return '';
  return /^[a-z]/.test(slug) ? slug : `role_${slug}`.slice(0, 40);
}

/** Validates an incoming role-permission map from the admin UI. */
function validateRolePermissions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'roles object is required.' };
  }

  const currentRoles = getRolePermissions();
  const labels = getRoleLabels();
  const next = {};

  for (const role of Object.keys(currentRoles)) {
    const incoming = input[role];
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return { error: `Missing permissions for role "${labels[role] || role}".` };
    }
    const cleaned = {};
    for (const key of PERM_KEYS) {
      if (typeof incoming[key] !== 'boolean') {
        return { error: `Permission "${key}" for "${labels[role] || role}" must be true or false.` };
      }
      cleaned[key] = incoming[key];
    }
    if (cleaned.upload && !cleaned.allBrands) {
      return { error: `"${labels[role] || role}" cannot have Upload without All brands.` };
    }
    if (role === 'admin' && !cleaned.manageUsers) {
      return { error: 'Admin must always keep Manage users permission.' };
    }
    next[role] = cleaned;
  }

  return { value: next };
}

async function saveRolePermissions(input) {
  const checked = validateRolePermissions(input);
  if (checked.error) return checked;
  const store = readStore();
  await kv.set(ROLE_PERMISSIONS_KEY, { permissions: checked.value, labels: store.labels });
  return { value: getRolePermissions() };
}

/** Adds a new custom role with a display label and optional key/initial permissions. */
async function addRole(input) {
  const label = typeof input?.label === 'string' ? input.label.trim() : '';
  if (label.length < 2 || label.length > 40) {
    return { error: 'Role name must be 2 to 40 characters.' };
  }
  const key = typeof input?.key === 'string' && input.key.trim()
    ? input.key.trim().toLowerCase()
    : slugifyRoleKey(label);

  if (!ROLE_KEY_RE.test(key)) {
    return { error: 'Role key must start with a letter and use only lowercase letters, numbers, or underscores.' };
  }

  const existingPerms = getRolePermissions();
  const existingLabels = getRoleLabels();
  if (Object.prototype.hasOwnProperty.call(existingPerms, key)) {
    return { error: `A role with key "${key}" already exists.` };
  }
  if (Object.values(existingLabels).some((l) => l.toLowerCase() === label.toLowerCase())) {
    return { error: `A role named "${label}" already exists.` };
  }

  const store = readStore();
  const nextPermissions = { ...existingPerms, [key]: normalizeRolePerms(key, input?.perms) };
  const nextLabels = { ...store.labels, [key]: label };
  await kv.set(ROLE_PERMISSIONS_KEY, { permissions: nextPermissions, labels: nextLabels });
  return { value: { key, label, roles: getRolePermissions(), roleLabels: getRoleLabels() } };
}

/** Deletes a custom role (built-in roles cannot be deleted). */
async function deleteRole(key) {
  const roleKey = typeof key === 'string' ? key.trim() : '';
  if (BUILT_IN_ROLES.includes(roleKey)) {
    return { error: 'Built-in roles cannot be deleted.' };
  }
  const store = readStore();
  const existingPerms = getRolePermissions();
  if (!Object.prototype.hasOwnProperty.call(existingPerms, roleKey)) {
    return { error: 'Role not found.' };
  }
  const nextPermissions = { ...existingPerms };
  delete nextPermissions[roleKey];
  const nextLabels = { ...store.labels };
  delete nextLabels[roleKey];
  await kv.set(ROLE_PERMISSIONS_KEY, { permissions: nextPermissions, labels: nextLabels });
  return { value: { roles: getRolePermissions(), roleLabels: getRoleLabels() } };
}

/** Resets built-in roles to defaults while preserving any custom roles. */
async function resetRolePermissions() {
  const store = readStore();
  const customPermissions = {};
  const customLabels = {};
  for (const [role, perms] of Object.entries(store.permissions)) {
    if (!BUILT_IN_ROLES.includes(role) && ROLE_KEY_RE.test(role)) {
      customPermissions[role] = normalizeRolePerms(role, perms);
      if (store.labels[role]) customLabels[role] = store.labels[role];
    }
  }
  if (Object.keys(customPermissions).length) {
    await kv.set(ROLE_PERMISSIONS_KEY, { permissions: customPermissions, labels: customLabels });
  } else {
    await kv.delete(ROLE_PERMISSIONS_KEY);
  }
  return getRolePermissions();
}

module.exports = {
  ROLES,
  ROLE_LABELS,
  BUILT_IN_ROLES,
  PERM_KEYS,
  PERM_META,
  getRolePermissions,
  getRoleLabels,
  validateRolePermissions,
  saveRolePermissions,
  addRole,
  deleteRole,
  resetRolePermissions,
};
