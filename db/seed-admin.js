/**
 * Run once to create your first admin user:
 *   node db/seed-admin.js
 *
 * Uses .env for Supabase creds and first-admin credentials.
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const supabase = require('./supabase');

const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');

if (!ADMIN_EMAIL) {
  console.error('Seed failed: set ADMIN_EMAIL in .env.');
  process.exit(1);
}
if (!ADMIN_PASSWORD) {
  console.error('Seed failed: set ADMIN_PASSWORD in .env.');
  process.exit(1);
}

async function seed() {
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);

  const { data, error } = await supabase
    .from('admin_users')
    .upsert(
      { email: ADMIN_EMAIL, password: hash, role: 'admin' },
      { onConflict: 'email' }
    )
    .select();

  if (error) {
    console.error('❌  Seed failed:', error.message);
    process.exit(1);
  }

  console.log('✅  Admin user created / updated:');
  console.log(`   Email:    ${ADMIN_EMAIL}`);
  console.log(`   Role:     admin`);
  console.log(`   ID:       ${data[0].id}`);
}

seed();
