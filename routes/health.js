// ── health.js ──────────────────────────────────
const express1 = require('express');
const r1 = express1.Router();

r1.get('/', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Campus-Connect backend is healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

module.exports = r1;
