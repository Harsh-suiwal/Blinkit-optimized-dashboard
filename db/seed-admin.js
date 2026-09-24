/**
 * Run once to create your first admin user:
 *   node db/seed-admin.js
 *
 * Uses .env for Supabase creds.
 * Change the email/password below to your own before running.
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const supabase = require('./supabase');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@blinkit.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme123';

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
  console.log(`   Password: ${ADMIN_PASSWORD}`);
  console.log(`   Role:     admin`);
  console.log(`   ID:       ${data[0].id}`);
}

seed();
