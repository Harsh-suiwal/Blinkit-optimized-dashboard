/**
 * Users & Role Permissions (admin only: permission manageUsers). Mounted at /api/users.
 *   GET    /api/users                    list users, roles, brands, and current role permissions
 *   POST   /api/users                    create a user (email, password, name, role, brands, active)
 *   PATCH  /api/users/:id                change name, role, brands, active
 *   POST   /api/users/:id/password       set or reset a password (users cannot change their own)
 *   GET    /api/users/permissions        get role-permission matrix and metadata
 *   PUT    /api/users/permissions        update and persist role permissions
 *   POST   /api/users/permissions/reset  restore default role permissions
 * Passwords are stored as bcrypt hashes and are never sent back. Deactivating a user or resetting a
 * password ends that user's sessions at once. The last active admin cannot be demoted or deactivated.
 */
const express = require('express');
const bcrypt = require('bcrypt');
const supabase = require('../db/supabase');
const kv = require('../store/kv');
const accounts = require('../store/accounts');
const brandRegistry = require('../store/brandRegistry');
const { requirePerm } = require('../middleware/access');
const {
  ROLE_LABELS,
  PERM_KEYS,
  PERM_META,
  getRolePermissions,
  saveRolePermissions,
  resetRolePermissions,
} = require('../config/permissions');

const BCRYPT_ROUNDS = 12;

function wrap(handler) {
  return (req, res) => Promise.resolve(handler(req, res)).catch((err) => {
    console.error(`${req.method} ${req.path} failed:`, err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Saving failed. Please try again.' });
  });
}

function createUsersRouter({ knownBrands, dataBrands }) {
  const router = express.Router();
  router.use(requirePerm('manageUsers'));

  async function allUsers() {
    const { data, error } = await supabase.from('admin_users').select('id, email, role');
    if (error) throw new Error(error.message);
    return (data || []).map((row) => {
      const profile = accounts.profileOf(row.id);
      return { id: row.id, email: row.email, role: row.role, name: profile.name, brands: profile.brands, active: profile.active };
    });
  }

  router.get('/', wrap(async (req, res) => {
    res.json({
      users: await allUsers(),
      roles: accounts.roleOptions(),
      brands: knownBrands(),
      permissions: getRolePermissions(),
      permKeys: PERM_KEYS,
      permMeta: PERM_META,
    });
  }));

  router.get('/permissions', wrap(async (req, res) => {
    res.json({
      roles: getRolePermissions(),
      roleLabels: ROLE_LABELS,
      permKeys: PERM_KEYS,
      permMeta: PERM_META,
    });
  }));

  router.put('/permissions', wrap(async (req, res) => {
    const result = await kv.withLock(() => saveRolePermissions(req.body && req.body.roles));
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true, roles: result.value });
  }));

  router.post('/permissions/reset', wrap(async (req, res) => {
    const roles = await kv.withLock(() => resetRolePermissions());
    res.json({ ok: true, roles });
  }));

  router.post('/', wrap(async (req, res) => {
    const checked = accounts.validateNewUser(req.body || {}, knownBrands());
    if (checked.error) return res.status(400).json({ error: checked.error });
    const v = checked.value;

    const hash = await bcrypt.hash(v.password, BCRYPT_ROUNDS);
    const { data, error } = await supabase
      .from('admin_users')
      .insert({ email: v.email, password: hash, role: v.role })
      .select('id, email, role')
      .single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'A user with this email already exists.' });
      throw new Error(error.message);
    }
    await accounts.saveProfile(data.id, { name: v.name, brands: v.brands, active: v.active });
    res.status(201).json({ user: { ...data, name: v.name, brands: v.brands, active: v.active } });
  }));

  router.patch('/:id', wrap(async (req, res) => {
    const users = await allUsers();
    const target = users.find((u) => u.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found.' });

    const checked = accounts.validateUserPatch(req.body || {}, knownBrands());
    if (checked.error) return res.status(400).json({ error: checked.error });
    const v = checked.value;

    const nextRole = v.role !== undefined ? v.role : target.role;
    const nextActive = v.active !== undefined ? v.active : target.active;
    if (accounts.lastActiveAdminBlocked(users, target.id, nextRole, nextActive)) {
      return res.status(409).json({ error: 'At least one active admin must remain.' });
    }

    if (v.role !== undefined && v.role !== target.role) {
      const { error } = await supabase.from('admin_users').update({ role: v.role }).eq('id', target.id);
      if (error) throw new Error(error.message);
    }
    const profilePatch = {};
    if (v.name !== undefined) profilePatch.name = v.name;
    if (v.brands !== undefined) profilePatch.brands = v.brands;
    if (v.active !== undefined) profilePatch.active = v.active;
    if (Object.keys(profilePatch).length) await accounts.saveProfile(target.id, profilePatch);
    if (nextActive === false) await accounts.endSessionsOf(target.id);

    const after = (await allUsers()).find((u) => u.id === target.id);
    res.json({ user: after });
  }));

  router.post('/:id/password', wrap(async (req, res) => {
    const checked = accounts.validatePassword(req.body || {});
    if (checked.error) return res.status(400).json({ error: checked.error });

    const { data: row, error: findError } = await supabase.from('admin_users').select('id').eq('id', req.params.id).maybeSingle();
    if (findError) throw new Error(findError.message);
    if (!row) return res.status(404).json({ error: 'User not found.' });

    const hash = await bcrypt.hash(checked.value, BCRYPT_ROUNDS);
    const { error } = await supabase.from('admin_users').update({ password: hash }).eq('id', row.id);
    if (error) throw new Error(error.message);
    await accounts.endSessionsOf(row.id);
    res.json({ ok: true });
  }));

  // Brand names an admin can add without any uploaded data.
  router.post('/brands', wrap(async (req, res) => {
    const result = await brandRegistry.add((req.body || {}).name, knownBrands());
    if (result.error) return res.status(400).json({ error: result.error });
    res.status(201).json({ brands: knownBrands() });
  }));

  // Removes a registry-only brand. Refused while it has uploaded data or a user has it ticked.
  router.delete('/brands', wrap(async (req, res) => {
    const name = String((req.query && req.query.name) || '').trim();
    const lower = name.toLowerCase();
    if (dataBrands().some((b) => b.toLowerCase() === lower)) {
      return res.status(409).json({ error: 'This brand has uploaded data. Delete its data first.' });
    }
    const users = await allUsers();
    if (users.some((u) => u.brands.some((b) => b.toLowerCase() === lower))) {
      return res.status(409).json({ error: 'A user still has this brand. Untick it first.' });
    }
    const result = await brandRegistry.remove(name);
    if (result.error) return res.status(404).json({ error: result.error });
    res.json({ brands: knownBrands() });
  }));

  return router;
}

module.exports = { createUsersRouter };