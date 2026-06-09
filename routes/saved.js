const express = require('express');
const router  = express.Router();
const pool    = require('../models/db');
const authMiddleware = require('../middleware/auth');

// GET /api/saved — get current user's saved listings
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        l.id, l.title, l.price, l.condition, l.image_urls, l.category,
        l.stock_quantity, l.average_rating, l.rating_count, l.status,
        l.whatsapp_phone, l.created_at, l.expires_at, l.sold_at,
        u.username, u.shop_name,
        sl.created_at AS saved_at
      FROM saved_listings sl
      JOIN listings l ON sl.listing_id = l.id
      JOIN users    u ON l.user_id     = u.id
      WHERE sl.user_id = $1
      ORDER BY sl.created_at DESC
    `, [req.user.userId]);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows.map((r) => ({
        ...r,
        price:          Number(r.price) || 0,
        average_rating: Number(r.average_rating) || 0,
        rating_count:   Number(r.rating_count) || 0,
        stock_quantity: Number(r.stock_quantity) || 0,
        image_urls:     Array.isArray(r.image_urls) ? r.image_urls : [],
      })),
    });
  } catch (err) {
    console.error('GET /saved error:', err);
    res.status(500).json({ message: 'Failed to load saved listings' });
  }
});

// POST /api/saved/:listingId — save a listing
router.post('/:listingId', authMiddleware, async (req, res) => {
  const { listingId } = req.params;
  const userId = req.user.userId;

  try {
    const check = await pool.query(
      'SELECT id FROM listings WHERE id = $1 AND status = $2',
      [listingId, 'approved']
    );
    if (check.rowCount === 0) return res.status(404).json({ message: 'Listing not found' });

    await pool.query(
      'INSERT INTO saved_listings (user_id, listing_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, listingId]
    );

    res.status(201).json({ success: true, message: 'Listing saved' });
  } catch (err) {
    console.error('POST /saved/:id error:', err);
    res.status(500).json({ message: 'Failed to save listing' });
  }
});

// DELETE /api/saved/:listingId — unsave a listing
router.delete('/:listingId', authMiddleware, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM saved_listings WHERE user_id = $1 AND listing_id = $2',
      [req.user.userId, req.params.listingId]
    );
    res.json({ success: true, message: 'Listing removed from saved' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/saved/check/:listingId — check if a listing is saved
router.get('/check/:listingId', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id FROM saved_listings WHERE user_id = $1 AND listing_id = $2',
      [req.user.userId, req.params.listingId]
    );
    res.json({ saved: result.rowCount > 0 });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
