/**
 * import_to_db.js
 * 
 * Imports data from render_export.json into your target database.
 * Works for local PostgreSQL, Supabase, Railway, or any PostgreSQL.
 * 
 * Usage:
 *   1. Run export_from_render.js first to generate render_export.json
 *   2. Set DATABASE_URL in your .env to the TARGET database
 *   3. Run: node import_to_db.js
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const isSupabase = process.env.DATABASE_URL?.includes('supabase');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(isSupabase ? { ssl: { rejectUnauthorized: false } } : {}),
});

const run = async () => {
  if (!fs.existsSync('render_export.json')) {
    console.error('❌ render_export.json not found. Run export_from_render.js first.');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync('render_export.json', 'utf8'));
  console.log(`Importing data exported at: ${data.exported_at}`);
  console.log(`Total rows to import: ${data.total_rows}\n`);

  const client = await pool.connect();

  // Import in order to respect foreign keys
  const ORDER = [
    'users',
    'listings',
    'ratings',
    'feedback',
    'team_members',
    'app_settings',
    'stats',
    'reports',
    'saved_listings',
    'visitor_sessions',
    'auctions',
    'auction_bids',
  ];

  for (const table of ORDER) {
    const rows = data.tables[table];
    if (!rows || rows.length === 0) {
      console.log(`⊘  ${table}: no data`);
      continue;
    }

    try {
      // Build INSERT from first row's keys
      const keys   = Object.keys(rows[0]);
      const cols   = keys.map(k => `"${k}"`).join(', ');
      const vals   = keys.map((_, i) => `$${i + 1}`).join(', ');
      const update = keys.filter(k => k !== 'id').map(k => `"${k}" = EXCLUDED."${k}"`).join(', ');

      let inserted = 0;
      for (const row of rows) {
        const values = keys.map(k => row[k] === undefined ? null : row[k]);
        await client.query(
          `INSERT INTO ${table} (${cols}) VALUES (${vals})
           ON CONFLICT (id) DO UPDATE SET ${update}`,
          values
        );
        inserted++;
      }

      // Reset the sequence so new inserts don't conflict
      try {
        await client.query(
          `SELECT setval(pg_get_serial_sequence('${table}', 'id'), MAX(id)) FROM ${table}`
        );
      } catch (_) {} // not all tables have sequences

      console.log(`✓ ${table}: ${inserted} rows imported`);
    } catch (err) {
      console.error(`✗ ${table}: ${err.message}`);
    }
  }

  client.release();
  await pool.end();
  console.log('\n✅ Import complete!');
};

run().catch(err => {
  console.error('❌ Import failed:', err.message);
  process.exit(1);
});
