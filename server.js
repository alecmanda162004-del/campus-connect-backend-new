// backend/server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

// Import your route files
const healthRouter = require('./routes/health');
const listingsRouter = require('./routes/listings');
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');
const uploadRouter = require('./routes/upload');
const usersRouter = require('./routes/users');
const settingsRouter = require('./routes/settings');
const feedbackRouter = require('./routes/feedback');

dotenv.config();

const app = express();

// ────────────────────────────────────────────────
// PORT – Render forces process.env.PORT
const PORT = process.env.PORT || 5000;

// ────────────────────────────────────────────────
// CORS – allow your actual frontend domains
app.use(cors({
  origin: [
    'https://campus-connect-frontend3.vercel.app',   // ← your Vercel URL
    'http://localhost:3000',                         // local dev
    'http://localhost:5173'                          // if using Vite
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Parse JSON bodies
app.use(express.json());

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

// ────────────────────────────────────────────────
// Simple root + health endpoint (useful for Render/Vercel)
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
// 404 handler – catch unknown routes
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
    'https://campus-connect-frontend3.vercel.app',
    'http://localhost:3000'
  ]);
});