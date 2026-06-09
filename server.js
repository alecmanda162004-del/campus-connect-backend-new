const express = require('express');
const cors    = require('cors');
const crypto  = require('crypto');
const dotenv  = require('dotenv');
dotenv.config();

if (!process.env.JWT_SECRET)   throw new Error('JWT_SECRET env var is not set');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL env var is not set');

const healthRouter   = require('./routes/health');
const listingsRouter = require('./routes/listings');
const authRouter     = require('./routes/auth');
const adminRouter    = require('./routes/admin');
const uploadRouter   = require('./routes/upload');
const usersRouter    = require('./routes/users');
const settingsRouter = require('./routes/settings');
const feedbackRouter = require('./routes/feedback');
const teamRouter     = require('./routes/team');
const reportsRouter  = require('./routes/reports');
const savedRouter    = require('./routes/saved');
const auctionsRouter = require('./routes/auctions');
const pool           = require('./models/db');

const app  = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: [
    'https://campus-connect-zm.com',
    'https://www.campus-connect-zm.com',
    'https://campus-connect-frontend-three.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
  ],
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

app.use(express.json());

// ── Unique visitor tracker — fires on every GET /api/listings (real page loads)
app.use(async (req, res, next) => {
  const track = req.path === '/api/listings' && req.method === 'GET';
  if (!track) return next();
  const ua    = req.headers['user-agent'] || '';
  const isBot = /bot|crawl|spider|slurp|facebookexternalhit/i.test(ua);
  if (isBot) return next();
  try {
    const sessionId = crypto
      .createHash('sha256')
      .update((req.ip || '') + ua.slice(0, 100) + new Date().toDateString())
      .digest('hex');
    await pool.query(
      'INSERT INTO visitor_sessions (session_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [sessionId]
    );
  } catch (_) {}
  next();
});

// ── Auto-close expired auctions on every request (lightweight check)
app.use(async (req, res, next) => {
  if (req.path === '/api/auctions' || req.path.startsWith('/api/auctions/')) {
    try {
      await pool.query(`
        UPDATE auctions SET status = 'ended',
          winner_id = (SELECT bidder_id FROM auction_bids WHERE auction_id = auctions.id ORDER BY amount DESC LIMIT 1)
        WHERE status = 'active' AND ends_at <= NOW()
      `);
    } catch (_) {}
  }
  next();
});

// ── Ban check
app.use(async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return next();
  try {
    const jwt    = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result  = await pool.query('SELECT is_banned FROM users WHERE id = $1', [decoded.userId]);
    if (result.rows[0]?.is_banned) {
      return res.status(403).json({ message: 'Your account has been suspended. Contact support.' });
    }
  } catch (_) {}
  next();
});

app.use('/api/health',    healthRouter);
app.use('/api/listings',  listingsRouter);
app.use('/api/auth',      authRouter);
app.use('/api/admin',     adminRouter);
app.use('/api/upload',    uploadRouter);
app.use('/api/users',     usersRouter);
app.use('/api/settings',  settingsRouter);
app.use('/api/feedback',  feedbackRouter);
app.use('/api/team',      teamRouter);
app.use('/api/reports',   reportsRouter);
app.use('/api/saved',     savedRouter);
app.use('/api/auctions',  auctionsRouter);

app.get('/', (req, res) => res.json({ message: 'Campus-Connect API v2', status: 'ok' }));
app.use((req, res) => res.status(404).json({ error: 'Not Found', path: req.originalUrl }));
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(err.status || 500).json({ error: 'Internal Server Error', message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message });
});

app.listen(PORT, () => console.log(`Campus-Connect API v2 running on port ${PORT}`));
