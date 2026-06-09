const { Pool } = require('pg');
require('dotenv').config();

const isSupabase = process.env.DATABASE_URL?.includes('supabase');
const isLocal    = process.env.DATABASE_URL?.includes('localhost');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 20,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL client error:', err.message);
});

(async () => {
  try {
    const client = await pool.connect();
    console.log('PostgreSQL connected successfully');
    client.release();
  } catch (err) {
    console.error('PostgreSQL connection failed:', err.message);
  }
})();

process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});

module.exports = pool;