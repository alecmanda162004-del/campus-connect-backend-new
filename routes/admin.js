const express = require('express');
const router  = express.Router();
const pool    = require('../models/db');
const authMiddleware  = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin');
const { notifyListingDecision } = require('../utils/notifications');
const { notifyNewListingTelegram } = require('../utils/telegram');

const adminOnly = [authMiddleware, adminMiddleware];

// GET /api/admin/pending
router.get('/pending', adminOnly, async (req, res) => {
  try {
    const page   = parseInt(req.query.page) || 1;
    const limit  = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const [data, count] = await Promise.all([
      pool.query(`
        SELECT l.id, l.title, l.description, l.price, l.condition, l.image_urls,
               l.stock_quantity, l.category, l.created_at, l.whatsapp_phone,
               u.username, u.email
        FROM listings l
        JOIN users u ON l.user_id = u.id
        WHERE l.status = 'pending'
        ORDER BY l.created_at DESC
        LIMIT $1 OFFSET $2
      `, [limit, offset]),
      pool.query("SELECT COUNT(*) FROM listings WHERE status = 'pending'"),
    ]);

    res.json({
      status: 'success',
      count:  data.rows.length,
      total:  parseInt(count.rows[0].count),
      page,
      pages:  Math.ceil(parseInt(count.rows[0].count) / limit),
      data:   data.rows.map((r) => ({
        ...r,
        price:     Number(r.price) || 0,
        image_urls: Array.isArray(r.image_urls) ? r.image_urls : [],
      })),
    });
  } catch (err) {
    console.error('GET /admin/pending error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/admin/listings/:id — approve or reject
router.patch('/listings/:id', adminOnly, async (req, res) => {
  const { status } = req.body;
  if (!['approved','rejected'].includes(status)) {
    return res.status(400).json({ message: 'status must be approved or rejected' });
  }

  try {
    const result = await pool.query(
      `UPDATE listings SET status = $1 WHERE id = $2 RETURNING id, title, status, user_id, price, category`,
      [status, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Listing not found' });

    const listing = result.rows[0];

    // Notify seller
    const sellerResult = await pool.query('SELECT email FROM users WHERE id = $1', [listing.user_id]);
    if (sellerResult.rows[0]?.email) {
      notifyListingDecision(sellerResult.rows[0].email, listing, status);
    }

    // Post to Telegram channel when approved
    if (status === 'approved') {
      notifyNewListingTelegram(listing).catch(() => {});
    }

    res.json({ message: `Listing ${status}`, data: listing });
  } catch (err) {
    console.error('PATCH /admin/listings/:id error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/listings/bulk — bulk approve or reject
router.post('/listings/bulk', adminOnly, async (req, res) => {
  const { ids, status } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: 'ids must be a non-empty array' });
  }
  if (!['approved','rejected'].includes(status)) {
    return res.status(400).json({ message: 'status must be approved or rejected' });
  }

  try {
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
    const result = await pool.query(
      `UPDATE listings SET status = $1 WHERE id IN (${placeholders}) AND status = 'pending' RETURNING id, title, status, user_id`,
      [status, ...ids]
    );

    // Notify each seller
    for (const listing of result.rows) {
      const sellerResult = await pool.query('SELECT email FROM users WHERE id = $1', [listing.user_id]);
      if (sellerResult.rows[0]?.email) {
        notifyListingDecision(sellerResult.rows[0].email, listing, status);
      }
    }

    res.json({ message: `${result.rowCount} listings ${status}`, count: result.rowCount });
  } catch (err) {
    console.error('POST /admin/listings/bulk error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/admin/stats
router.get('/stats', adminOnly, async (req, res) => {
  try {
    const [users, visits, pending, reports, saved] = await Promise.all([
      pool.query('SELECT COUNT(*) AS total FROM users'),
      pool.query('SELECT COUNT(DISTINCT session_id) AS unique_visitors FROM visitor_sessions'),
      pool.query("SELECT COUNT(*) AS pending FROM listings WHERE status = 'pending'"),
      pool.query("SELECT COUNT(*) AS total FROM reports WHERE status = 'pending'"),
      pool.query('SELECT COUNT(*) AS total FROM saved_listings'),
    ]);

    res.json({
      totalUsers:      parseInt(users.rows[0].total),
      totalVisits:     parseInt(visits.rows[0].unique_visitors),
      pendingListings: parseInt(pending.rows[0].pending),
      pendingReports:  parseInt(reports.rows[0].total),
      totalSaved:      parseInt(saved.rows[0].total),
    });
  } catch (err) {
    console.error('GET /admin/stats error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/admin/stats/users
router.get('/stats/users', adminOnly, async (req, res) => {
  try {
    const r = await pool.query('SELECT COUNT(*) AS total FROM users');
    res.json({ total: parseInt(r.rows[0].total) });
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// GET /api/admin/stats/visits
router.get('/stats/visits', adminOnly, async (req, res) => {
  try {
    const r = await pool.query('SELECT COUNT(DISTINCT session_id) AS unique_visitors FROM visitor_sessions');
    res.json({ totalVisits: parseInt(r.rows[0].unique_visitors) });
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// GET /api/admin/users — user management
router.get('/users', adminOnly, async (req, res) => {
  try {
    const page   = parseInt(req.query.page) || 1;
    const limit  = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search?.trim();

    let where       = 'WHERE 1=1';
    const params    = [];
    let paramIndex  = 1;

    if (search) {
      where += ` AND (username ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    const [data, count] = await Promise.all([
      pool.query(`
        SELECT id, username, email, role, is_banned, is_verified,
               seller_rating, seller_rating_count, created_at, banned_at, ban_reason,
               (SELECT COUNT(*) FROM listings WHERE user_id = users.id) AS listing_count
        FROM users
        ${where}
        ORDER BY created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `, [...params, limit, offset]),
      pool.query(`SELECT COUNT(*) FROM users ${where}`, params),
    ]);

    res.json({
      success: true,
      total:   parseInt(count.rows[0].count),
      page,
      data:    data.rows,
    });
  } catch (err) {
    console.error('GET /admin/users error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/admin/users/:id/ban — ban or unban a user
router.patch('/users/:id/ban', adminOnly, async (req, res) => {
  const { ban, reason } = req.body;
  const isBan = Boolean(ban);

  try {
    const result = await pool.query(
      `UPDATE users SET
         is_banned  = $1,
         banned_at  = $2,
         ban_reason = $3
       WHERE id = $4
       RETURNING id, username, is_banned`,
      [isBan, isBan ? new Date() : null, isBan ? (reason || 'Violation of terms') : null, req.params.id]
    );

    if (result.rowCount === 0) return res.status(404).json({ message: 'User not found' });
    res.json({ success: true, message: isBan ? 'User banned' : 'User unbanned', data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/admin/users/:id/verify — toggle verified badge
router.patch('/users/:id/verify', adminOnly, async (req, res) => {
  const { verified } = req.body;
  try {
    const result = await pool.query(
      'UPDATE users SET is_verified = $1 WHERE id = $2 RETURNING id, username, is_verified',
      [Boolean(verified), req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'User not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/admin/reports
router.get('/reports', adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.reason, r.details, r.status, r.created_at,
             l.id AS listing_id, l.title AS listing_title,
             u.username AS reporter
      FROM reports r
      JOIN listings l ON r.listing_id = l.id
      JOIN users    u ON r.user_id    = u.id
      WHERE r.status = 'pending'
      ORDER BY r.created_at DESC
    `);
    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});



// GET /api/admin/featured-hero — premium listing images for hero carousel
router.get('/featured-hero', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT l.id, l.title, l.price, l.category, l.image_urls, l.whatsapp_phone,
             u.username, u.shop_name
      FROM listings l
      JOIN users u ON l.user_id = u.id
      WHERE l.is_premium = TRUE
        AND l.status = 'approved'
        AND l.sold_at IS NULL
        AND (l.premium_expires_at IS NULL OR l.premium_expires_at > NOW())
        AND (l.expires_at IS NULL OR l.expires_at > NOW())
        AND l.image_urls IS NOT NULL
        AND array_length(l.image_urls, 1) > 0
      ORDER BY l.premium_expires_at DESC
      LIMIT 8
    `);

    const slides = result.rows
      .filter(l => Array.isArray(l.image_urls) && l.image_urls.length > 0)
      .map(l => ({
        id:       l.id,
        image:    l.image_urls[0],
        title:    l.title,
        price:    Number(l.price),
        category: l.category,
        seller:   l.shop_name || l.username,
      }));

    res.json({ success: true, data: slides });
  } catch (err) {
    console.error('GET /admin/featured-hero error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/admin/listings/:id/premium — toggle premium
router.patch('/listings/:id/premium', adminOnly, async (req, res) => {
  const { is_premium, days = 30 } = req.body;
  try {
    const expiresAt = is_premium
      ? new Date(Date.now() + Number(days) * 86400000).toISOString()
      : null;
    const result = await pool.query(
      `UPDATE listings SET is_premium = $1, premium_expires_at = $2 WHERE id = $3
       RETURNING id, title, is_premium, premium_expires_at`,
      [Boolean(is_premium), expiresAt, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Listing not found' });
    res.json({
      success: true,
      message: is_premium ? `Featured for ${days} days` : 'Featured removed',
      data: result.rows[0],
    });
  } catch (err) {
    console.error('PATCH premium error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;