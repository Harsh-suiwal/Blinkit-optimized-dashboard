/**
 * Role permissions: ONE true/false table. The server (middleware/access.js) and the pages both read it.
 * Defaults live here; admin edits are persisted in kv_store ('rolePermissions') via the Users & Permissions
 * page and take effect on each user's next request without editing this file.
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

const PERM_KEYS = ['allBrands', 'profit', 'upload', 'deleteData', 'download', 'manageUsers'];

const PERM_META = [
  { key: 'allBrands',   label: 'All brands',        description: 'See every brand; when off, restricted to ticked brands only.' },
  { key: 'profit',      label: 'View profit',       description: 'See profit figures, margins, and cost tabs.' },
  { key: 'upload',      label: 'Upload reports',    description: 'Upload stock, sales, campaign, and cost files (requires All brands).' },
  { key: 'deleteData',  label: 'Delete data',       description: 'Delete stored stock, sales, monthly, or campaign data.' },
  { key: 'download',    label: 'Download exports',  description: 'Export Excel workbooks.' },
  { key: 'manageUsers', label: 'Manage users',      description: 'Access Users page, manage accounts, and edit role permissions.' },
];

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

/** Current role-permission table (persisted overrides merged over defaults). */
function getRolePermissions() {
  const stored = typeof kv.get === 'function' ? kv.get(ROLE_PERMISSIONS_KEY) : null;
  const out = {};
  for (const role of Object.keys(ROLES)) {
    out[role] = normalizeRolePerms(role, stored && stored[role]);
  }
  return out;
}

/** Validates an incoming role-permission map from the admin UI. */
function validateRolePermissions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'roles object is required.' };
  }

  const next = {};
  for (const role of Object.keys(ROLES)) {
    const incoming = input[role];
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return { error: `Missing permissions for role "${ROLE_LABELS[role] || role}".` };
    }
    const cleaned = {};
    for (const key of PERM_KEYS) {
      if (typeof incoming[key] !== 'boolean') {
        return { error: `Permission "${key}" for "${ROLE_LABELS[role] || role}" must be true or false.` };
      }
      cleaned[key] = incoming[key];
    }
    if (cleaned.upload && !cleaned.allBrands) {
      return { error: `"${ROLE_LABELS[role] || role}" cannot have Upload without All brands.` };
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
  await kv.set(ROLE_PERMISSIONS_KEY, checked.value);
  return { value: getRolePermissions() };
}

async function resetRolePermissions() {
  await kv.delete(ROLE_PERMISSIONS_KEY);
  return getRolePermissions();
}

module.exports = {
  ROLES,
  ROLE_LABELS,
  PERM_KEYS,
  PERM_META,
  getRolePermissions,
  validateRolePermissions,
  saveRolePermissions,
  resetRolePermissions,
};