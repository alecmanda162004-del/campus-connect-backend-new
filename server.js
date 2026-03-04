const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { Pool } = require('pg');

// Import your route files
const healthRouter = require('./routes/health');
const listingsRouter = require('./routes/listings');
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');
const uploadRouter = require('./routes/upload');
const usersRouter = require('./routes/users');
const settingsRouter = require('./routes/settings');
const feedbackRouter = require('./routes/feedback');
const teamRoutes = require('./routes/team');

// Load environment variables
dotenv.config();

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const app = express();

// ────────────────────────────────────────────────
// PORT – Render forces process.env.PORT
const PORT = process.env.PORT || 5000;

// ────────────────────────────────────────────────
// CORS – allow your actual frontend domains
app.use(cors({
  origin: [
    'https://campus-connect-frontend-three.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Parse JSON bodies
app.use(express.json());

// ────────────────────────────────────────────────
// Auto-increment visits counter in table "stats"
// Now counts homepage (/) and most real page loads
app.use(async (req, res, next) => {
  // Skip only API calls and static file requests
  if (
    req.path.startsWith('/api') ||           // all API endpoints
    req.path.startsWith('/static') ||       // frontend static assets
    req.path.startsWith('/assets') ||       // common static folder
    req.path.includes('.')                  // any file with extension (.js, .css, .png, etc.)
  ) {
    return next();
  }

  try {
    const result = await pool.query(`
      INSERT INTO stats (key, value, updated_at)
      VALUES ('visits', 1, CURRENT_TIMESTAMP)
      ON CONFLICT (key)
      DO UPDATE SET
        value = stats.value + 1,
        updated_at = CURRENT_TIMESTAMP
      RETURNING value
    `);

    console.log(`Visit counted for path "${req.path}". Total visits now: ${result.rows[0].value}`);
  } catch (err) {
    console.error('Failed to count visit in stats table:', err.message);
  }

  next();
});

// ────────────────────────────────────────────────
// Routes
app.use('/api/health', healthRouter);
app.use('/api/listings', listingsRouter);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/users', usersRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/feedback', feedbackRouter);
app.use('/api/team', teamRoutes);

// ────────────────────────────────────────────────
// Admin Stats Endpoints
app.get('/api/admin/stats/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) AS total FROM users');
    const total = parseInt(result.rows[0].total, 10);
    res.json({ total });
  } catch (err) {
    console.error('Users stats error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

app.get('/api/admin/stats/visits', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT value AS "totalVisits"
      FROM stats
      WHERE key = 'visits'
    `);

    const totalVisits = result.rows.length > 0 
      ? parseInt(result.rows[0].totalVisits, 10) 
      : 0;

    console.log(`Admin requested visits stat: ${totalVisits}`);

    res.json({ totalVisits });
  } catch (err) {
    console.error('Visits stats error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ────────────────────────────────────────────────
// Simple root + health endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Campus-Connect Backend is running!',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Backend is healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ────────────────────────────────────────────────
// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.originalUrl}`
  });
});

// ────────────────────────────────────────────────
// Global error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(err.status || 500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message
  });
});

// ────────────────────────────────────────────────
// Start server
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`CORS allowed origins:`, [
    'https://campus-connect-frontend-three.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173'
  ]);
});