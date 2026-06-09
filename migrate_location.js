require('dotenv').config();
const pool = require('./models/db');

const run = async () => {
  console.log('Adding location fields...');
  await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS location TEXT`);
  await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS campus TEXT`);
  await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS availability TEXT`);
  await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS price_type TEXT DEFAULT 'fixed'`);
  await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS tags TEXT[]`);
  console.log('✓ location, campus, availability, price_type, tags');

  await pool.query(`ALTER TABLE auctions ADD COLUMN IF NOT EXISTS location TEXT`);
  console.log('✓ auctions.location');

  console.log('\n✅ Done!');
  process.exit(0);
};
run().catch(err => { console.error('❌', err.message); process.exit(1); });
