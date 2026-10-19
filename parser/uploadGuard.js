const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { todayDateString } = require('./snapshotHistory');

// data/uploadHashes.json = { inventory: { "<sha256>": "<YYYY-MM-DD>" }, sales: {...}, campaign: {...} }
// Remembers which exact files were already processed today so an accidental re-upload
// (double click, same file twice) is skipped. Only today's entries are kept.
const STORE_PATH = path.join(__dirname, '..', 'data', 'uploadHashes.json');

function load() {
  try {
    if (!fs.existsSync(STORE_PATH)) return {};
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function save(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/** True when this exact file was already processed today for this kind (inventory|sales|campaign). */
function isDuplicateUpload(kind, hash) {
  return load()[kind]?.[hash] === todayDateString();
}

/** Remembers a processed file; drops entries from earlier days. */
function recordUpload(kind, hash) {
  const today = todayDateString();
  const store = load();
  for (const k of Object.keys(store)) {
    for (const h of Object.keys(store[k])) if (store[k][h] !== today) delete store[k][h];
  }
  store[kind] = { ...store[kind], [hash]: today };
  save(store);
}

/** Forgets a kind's hashes, so data that was deleted can be re-uploaded from the same file. */
function clearUploadHashes(kind) {
  const store = load();
  if (!store[kind]) return;
  delete store[kind];
  save(store);
}

module.exports = { hashFile, isDuplicateUpload, recordUpload, clearUploadHashes };
