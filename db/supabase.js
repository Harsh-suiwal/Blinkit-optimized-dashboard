const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌  Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

// We use the service-role key server-side so we can bypass RLS.
// Never expose this key to the browser.
const supabase = createClient(supabaseUrl, supabaseServiceKey);

module.exports = supabase;
