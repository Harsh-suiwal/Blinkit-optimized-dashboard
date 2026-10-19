// One-time upload of local data/*.json into the Supabase kv_store table.
//   node scripts/migrate-json-to-kv.js --dry-run   list what would be uploaded (key + size), write nothing
//   node scripts/migrate-json-to-kv.js             upload; refuses if kv_store already has rows
//   node scripts/migrate-json-to-kv.js --force     upload even if kv_store has rows (overwrites those keys)
// data/campaignData.v1.json (pre-rewrite campaign format) is intentionally not migrated.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const supabase = require('../db/supabase');

const DATA_DIR = path.join(__dirname, '..', 'data');
const KEYS = ['latest', 'history', 'salesLatest', 'salesByProduct', 'salesHistory', 'campaignData', 'brandAliases', 'uploadHashes'];

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const force = args.has('--force');

(async () => {
  const docs = [];
  for (const key of KEYS) {
    const file = path.join(DATA_DIR, `${key}.json`);
    if (!fs.existsSync(file)) {
      console.log(`  skip  ${key} (no data/${key}.json)`);
      continue;
    }
    const raw = fs.readFileSync(file, 'utf-8');
    if (!raw.trim()) {
      console.log(`  skip  ${key} (empty file)`);
      continue;
    }
    const value = JSON.parse(raw); // a corrupt file aborts the whole run
    const size = Buffer.byteLength(JSON.stringify(value));
    docs.push({ key, value, size });
    console.log(`  ${dryRun ? 'would upload' : 'upload'}  ${key}  ${(size / 1024).toFixed(1)} KB`);
  }

  const { count, error: countError } = await supabase.from('kv_store').select('key', { count: 'exact', head: true });
  if (countError) throw new Error(`cannot read kv_store: ${countError.message}`);
  if (count > 0) console.log(`kv_store already has ${count} row(s).`);

  if (dryRun) {
    console.log(`Dry run: ${docs.length} key(s) would be uploaded. Nothing written.`);
    return;
  }
  if (count > 0 && !force) {
    console.error('Refusing to overwrite existing kv_store rows. Re-run with --force if that is intended.');
    process.exit(1);
  }
  if (!docs.length) {
    console.log('Nothing to upload.');
    return;
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('kv_store')
    .upsert(docs.map((d) => ({ key: d.key, value: d.value, updated_at: now })), { onConflict: 'key' });
  if (error) throw new Error(`upload failed: ${error.message}`);
  console.log(`Uploaded ${docs.length} key(s).`);
})().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
