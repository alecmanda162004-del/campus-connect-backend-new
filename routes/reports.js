const express = require('express');
const router  = express.Router();
const pool    = require('../models/db');
const authMiddleware  = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin');

const REASONS = ['scam','counterfeit','wrong_category','offensive','duplicate','other'];

// POST /api/reports — any logged-in user can report a listing
router.post('/', authMiddleware, async (req, res) => {
  const { listing_id, reason, details } = req.body;
  const userId = req.user.userId;

  if (!listing_id || !reason) {
    return res.status(400).json({ message: 'listing_id and reason are required' });
  }
  if (!REASONS.includes(reason)) {
    return res.status(400).json({ message: `reason must be one of: ${REASONS.join(', ')}` });
  }

  try {
    const listingCheck = await pool.query('SELECT id FROM listings WHERE id = $1', [listing_id]);
    if (listingCheck.rowCount === 0) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    await pool.query(
      `INSERT INTO reports (listing_id, user_id, reason, details)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (listing_id, user_id) DO UPDATE SET reason = $3, details = $4`,
      [listing_id, userId, reason, details?.trim() || null]
    );

    res.status(201).json({ message: 'Report submitted. Our team will review it.' });
  } catch (err) {
    console.error('POST /reports error:', err);
    res.status(500).json({ message: 'Failed to submit report' });
  }
});

// GET /api/reports — admin: list all pending reports
router.get('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        r.id, r.reason, r.details, r.status, r.created_at,
        l.id AS listing_id, l.title AS listing_title, l.status AS listing_status,
        u.username AS reporter
      FROM reports r
      JOIN listings l ON r.listing_id = l.id
      JOIN users   u ON r.user_id    = u.id
      ORDER BY r.created_at DESC
    `);
    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (err) {
    console.error('GET /reports error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/reports/:id — admin: dismiss or mark reviewed
router.patch('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { status } = req.body;
  if (!['reviewed','dismissed'].includes(status)) {
    return res.status(400).json({ message: 'status must be reviewed or dismissed' });
  }

  try {
    const result = await pool.query(
      'UPDATE reports SET status = $1 WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Report not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
