require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');

const RENDER_DB_URL = process.env.RENDER_DATABASE_URL;

if (!RENDER_DB_URL || RENDER_DB_URL.includes('YOUR_RENDER')) {
  console.error('❌ Set RENDER_DATABASE_URL in your .env file first');
  process.exit(1);
}

const TABLES = [
  'users', 'listings', 'ratings', 'feedback',
  'team_members', 'app_settings', 'stats',
  'reports', 'saved_listings', 'visitor_sessions',
];

const run = async () => {
  console.log('Connecting to Render database...');
  console.log('URL:', RENDER_DB_URL.replace(/:([^:@]+)@/, ':****@')); // hide password

  const client = new Client({
    connectionString: RENDER_DB_URL,
    ssl: {
      rejectUnauthorized: false,
      sslmode: 'require',
    },
    connectionTimeoutMillis: 15000,
    query_timeout: 30000,
  });

  try {
    await client.connect();
    console.log('✓ Connected!\n');
  } catch (err) {
    console.error('❌ Could not connect:', err.message);
    console.log('\nTroubleshooting:');
    console.log('1. Check your RENDER_DATABASE_URL in .env is the External Database URL');
    console.log('2. Make sure you copied the full URL including the database name at the end');
    console.log('3. Render free DBs expire after 90 days — check if yours is still active');
    process.exit(1);
  }

  const exported = {};
  let totalRows = 0;

  for (const table of TABLES) {
    try {
      // Check if table exists first
      const exists = await client.query(
        `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
        [table]
      );
      if (!exists.rows[0].exists) {
        console.log(`⊘  ${table}: does not exist, skipping`);
        exported[table] = [];
        continue;
      }

      const result = await client.query(`SELECT * FROM ${table}`);
      exported[table] = result.rows;
      totalRows += result.rows.length;
      console.log(`✓ ${table}: ${result.rows.length} rows`);
    } catch (err) {
      console.log(`⚠  ${table}: ${err.message}`);
      exported[table] = [];
    }
  }

  await client.end();

  const output = {
    exported_at: new Date().toISOString(),
    source: 'Render PostgreSQL',
    total_rows: totalRows,
    tables: exported,
  };

  fs.writeFileSync('render_export.json', JSON.stringify(output, null, 2));
  console.log(`\n✅ Export complete! ${totalRows} rows saved to render_export.json`);
};

run().catch(err => {
  console.error('❌ Unexpected error:', err.message);
  process.exit(1);
});