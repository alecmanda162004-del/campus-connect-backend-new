// backend/routes/admin.js
const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const authMiddleware = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin');

// ────────────────────────────────────────
// Middleware chain: must be logged in AND admin
// ────────────────────────────────────────
const adminOnly = [authMiddleware, adminMiddleware];

// GET /api/admin/pending - Get pending listings (paginated)
router.get('/pending', adminOnly, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const countResult = await pool.query(
      "SELECT COUNT(*) FROM listings WHERE status = 'pending'"
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(
      `SELECT 
        id, title, description, price, condition, whatsapp_phone, image_url, created_at
       FROM listings 
       WHERE status = 'pending' 
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.status(200).json({
      status: 'success',
      count: result.rows.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: result.rows,
    });
  } catch (err) {
    console.error('Error fetching pending listings:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// PATCH /api/admin/listings/:id - Approve or reject a listing
router.patch('/listings/:id', adminOnly, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status value. Must be "approved" or "rejected"' });
  }

  try {
    const result = await pool.query(
      'UPDATE listings SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, title, status, updated_at',
      [status, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    res.json({
      message: `Listing ${status} successfully`,
      data: result.rows[0],
    });
  } catch (err) {
    console.error('Error updating listing status:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET /api/admin/stats/users - Total users count
router.get('/stats/users', adminOnly, async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) AS total FROM users');
    res.json({ total: parseInt(result.rows[0].total) });
  } catch (err) {
    console.error('Error fetching user stats:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/admin/stats/visits - Total visits (using existing stats table)
router.get('/stats/visits', adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT value AS "totalVisits"
      FROM stats
      WHERE key = 'visits'
    `);

    // If no row exists yet, return 0
    const totalVisits = result.rows.length > 0 
      ? parseInt(result.rows[0].totalVisits, 10) 
      : 0;

    console.log(`Visits stat fetched: ${totalVisits}`); // temporary debug

    res.json({ totalVisits });
  } catch (err) {
    console.error('Error fetching visits stats:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Optional: GET /api/admin/stats - All stats in one call (updated for stats table)
router.get('/stats', adminOnly, async (req, res) => {
  try {
    const usersResult = await pool.query('SELECT COUNT(*) AS total FROM users');
    
    const visitsResult = await pool.query(`
      SELECT value AS "totalVisits"
      FROM stats
      WHERE key = 'visits'
    `);
    
    const pendingResult = await pool.query("SELECT COUNT(*) AS pending FROM listings WHERE status = 'pending'");

    const totalVisits = visitsResult.rows.length > 0 
      ? parseInt(visitsResult.rows[0].totalVisits, 10) 
      : 0;

    res.json({
      totalUsers: parseInt(usersResult.rows[0].total),
      totalVisits,
      pendingListings: parseInt(pendingResult.rows[0].pending),
    });
  } catch (err) {
    console.error('Error fetching all stats:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;