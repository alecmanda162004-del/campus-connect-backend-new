require('dotenv').config();
const pool = require('./models/db');

const run = async () => {
  console.log('Running auction migration...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auctions (
      id            SERIAL PRIMARY KEY,
      listing_id    INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      seller_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      start_price   NUMERIC(10,2) NOT NULL,
      current_bid   NUMERIC(10,2),
      reserve_price NUMERIC(10,2),
      bid_count     INTEGER NOT NULL DEFAULT 0,
      winner_id     INTEGER REFERENCES users(id),
      status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended','cancelled')),
      ends_at       TIMESTAMPTZ NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('✓ auctions table');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auction_bids (
      id         SERIAL PRIMARY KEY,
      auction_id INTEGER NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
      bidder_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount     NUMERIC(10,2) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('✓ auction_bids table');

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_auctions_status  ON auctions(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_auctions_ends_at ON auctions(ends_at)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bids_auction     ON auction_bids(auction_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bids_bidder      ON auction_bids(bidder_id)`);
  console.log('✓ indexes');

  console.log('\n✅ Auction migration complete!');
  process.exit(0);
};

run().catch((err) => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
