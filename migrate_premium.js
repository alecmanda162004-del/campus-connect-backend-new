require('dotenv').config();
const pool = require('./models/db');

const run = async () => {
  console.log('Running premium migration...');
  await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS premium_expires_at TIMESTAMPTZ`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_listings_premium ON listings(is_premium) WHERE is_premium = TRUE`);
  console.log('✓ is_premium, premium_expires_at added');
  console.log('\n✅ Done!');
  process.exit(0);
};
run().catch(err => { console.error('❌', err.message); process.exit(1); });
