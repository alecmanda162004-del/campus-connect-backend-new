// backend/models/db.js
const { Pool } = require('pg');
require('dotenv').config();

// ────────────────────────────────────────────────
// PostgreSQL connection pool – uses ONLY environment variable
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' 
        ? { rejectUnauthorized: false } // Required for cloud providers (Neon, Render, Supabase, etc.)
        : false,                        // Disable SSL for local development
  // Optional: increase connection timeout if Render/Neon is slow
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  max: 20  // max connections – adjust based on your free tier limits
});

// ────────────────────────────────────────────────
// Test connection on startup (logs to Render console)
pool.on('connect', () => {
  console.log('New client connected to PostgreSQL');
});

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client:', err.message);
  // Optional: exit process if critical (Render will restart)
  // process.exit(-1);
});

// Initial connection test
(async () => {
  try {
    const client = await pool.connect();
    console.log('PostgreSQL connected successfully!');
    console.log(`Connected to database: ${client.database}`);
    console.log(`Host: ${client.host}`);
    client.release();
  } catch (err) {
    console.error('Failed to connect to PostgreSQL:', err.stack);
    console.error('Check:');
    console.error('1. DATABASE_URL in Render Environment Variables?');
    console.error('2. Correct username/password/host/port/dbname?');
    console.error('3. SSL enabled in connection string?');
  }
})();

// ────────────────────────────────────────────────
// Graceful shutdown (Render sends SIGTERM on shutdown)
process.on('SIGTERM', async () => {
  console.log('SIGTERM received – closing PostgreSQL pool');
  await pool.end();
  console.log('PostgreSQL pool closed');
  process.exit(0);
});

module.exports = pool;
