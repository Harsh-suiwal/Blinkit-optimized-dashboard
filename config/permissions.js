/**
 * Role permissions: ONE true/false table. The server (middleware/access.js) and the pages both read it.
 * Changing a value here is the only edit needed to change what a role may do.
 *
 *   allBrands    sees every brand. false = only the brands ticked for the user; they never learn other brands exist.
 *   profit       sees profit figures (Profit tab, profit lines in product and report views).
 *   upload       uploads reports. Also needs allBrands (enforced in middleware/access.js).
 *   deleteData   deletes stored data (stock, sales, monthly sales, campaigns, a brand).
 *   download     downloads Excel exports.
 *   manageUsers  the Users page: create users, set passwords, roles, brand ticks, active flag.
 *
 * VALUES BELOW ARE PLACEHOLDERS. The team has not confirmed them yet.
 * A role name that is not in this table gets no access at all (fails closed).
 */
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

module.exports = { ROLES, ROLE_LABELS, PERM_KEYS };
