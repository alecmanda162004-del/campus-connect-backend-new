require('dotenv').config();
const pool = require('./models/db');

const run = async () => {
  console.log('Running full migration...\n');

  // ── Users
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS seller_rating NUMERIC(3,2) DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS seller_rating_count INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS average_rating NUMERIC(3,2) DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS shop_name TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
  console.log('✓ users columns');

  // ── Listings
  await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '60 days')`);
  await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
  await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS premium_expires_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS location TEXT`);
  await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS campus TEXT`);
  await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS availability TEXT`);
  await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS price_type TEXT DEFAULT 'fixed'`);
  await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS tags TEXT[]`);
  console.log('✓ listings columns');

  // ── Tables
  await pool.query(`CREATE TABLE IF NOT EXISTS reports (
    id SERIAL PRIMARY KEY, listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL, details TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewed','dismissed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(listing_id, user_id)
  )`);
  console.log('✓ reports');

  await pool.query(`CREATE TABLE IF NOT EXISTS saved_listings (
    id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id, listing_id)
  )`);
  console.log('✓ saved_listings');

  await pool.query(`CREATE TABLE IF NOT EXISTS visitor_sessions (
    id SERIAL PRIMARY KEY, session_id TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  console.log('✓ visitor_sessions');

  await pool.query(`CREATE TABLE IF NOT EXISTS auctions (
    id SERIAL PRIMARY KEY, listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_price NUMERIC(10,2) NOT NULL, current_bid NUMERIC(10,2), reserve_price NUMERIC(10,2),
    bid_count INTEGER NOT NULL DEFAULT 0, winner_id INTEGER REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended','cancelled')),
    ends_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  console.log('✓ auctions');

  await pool.query(`CREATE TABLE IF NOT EXISTS auction_bids (
    id SERIAL PRIMARY KEY, auction_id INTEGER NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
    bidder_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(10,2) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  console.log('✓ auction_bids');

  // ── Indexes
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_listings_premium ON listings(is_premium) WHERE is_premium = TRUE`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_listings_status  ON listings(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_auctions_status  ON auctions(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_auctions_ends_at ON auctions(ends_at)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bids_auction     ON auction_bids(auction_id)`);
  console.log('✓ indexes');

  console.log('\n✅ All done! Restart your server now.');
  process.exit(0);
};

run().catch(err => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});