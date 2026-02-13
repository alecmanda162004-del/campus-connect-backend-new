// backend/routes/listings.js
const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const authMiddleware = require('../middleware/auth');
const jwt = require('jsonwebtoken');

// ────────────────────────────────────────────────
// GET /api/listings
// Supports: ?page=1&limit=24&sort=newest|price-low|price-high
// ────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    // Query params
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 24;
    const sort = req.query.sort || 'newest';

    // Validate
    if (page < 1 || limit < 1 || limit > 100) {
      return res.status(400).json({ message: 'Invalid page or limit' });
    }

    // Sort mapping
    let orderBy = 'created_at DESC';
    if (sort === 'price-low') orderBy = 'price ASC';
    if (sort === 'price-high') orderBy = 'price DESC';

    const offset = (page - 1) * limit;

    // Main query (approved listings only for public marketplace)
    const listingsQuery = `
      SELECT 
        id, user_id, title, description, price, condition, whatsapp_phone,
        image_urls, stock_quantity, category, average_rating, rating_count,
        created_at
      FROM listings
      WHERE status = 'approved'
      ORDER BY ${orderBy}
      LIMIT $1 OFFSET $2
    `;

    const [listingsResult, totalResult] = await Promise.all([
      pool.query(listingsQuery, [limit, offset]),
      pool.query('SELECT COUNT(*) FROM listings WHERE status = $1', ['approved'])
    ]);

    const listings = listingsResult.rows.map(row => ({
      ...row,
      price: Number(row.price) || 0,
      average_rating: Number(row.average_rating) || 0,
      rating_count: Number(row.rating_count) || 0,
      stock_quantity: Number(row.stock_quantity) || 0,
    }));

    const total = parseInt(totalResult.rows[0].count);

    res.status(200).json({
      status: 'success',
      data: listings,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    });
  } catch (err) {
    console.error('Error fetching listings:', err.stack);
    res.status(500).json({ status: 'error', message: 'Failed to fetch listings' });
  }
});

// ────────────────────────────────────────────────
// NEW: GET /api/listings/categories/popular
// Returns top 10 categories with counts
// ────────────────────────────────────────────────
router.get('/categories/popular', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        category,
        COUNT(*) as count
      FROM listings
      WHERE status = 'approved' AND category IS NOT NULL AND category != ''
      GROUP BY category
      ORDER BY count DESC
      LIMIT 10
    `);

    const popular = result.rows.map(row => ({
      category: row.category,
      count: parseInt(row.count)
    }));

    res.status(200).json({
      status: 'success',
      data: popular
    });
  } catch (err) {
    console.error('Error fetching popular categories:', err.stack);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

// ────────────────────────────────────────────────
// Other existing routes (unchanged)
// ────────────────────────────────────────────────

// Get single listing, user listings, ratings, etc. remain the same...

// Get all approved listings (Marketplace) - public, paginated
router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;

    const result = await pool.query(`
      SELECT 
        id,
        user_id,
        title,
        description,
        price,
        condition,
        whatsapp_phone,
        image_urls,
        stock_quantity,
        category,
        average_rating,
        rating_count,
        created_at
      FROM listings
      WHERE status = 'approved'
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const totalResult = await pool.query(
      'SELECT COUNT(*) FROM listings WHERE status = $1',
      ['approved']
    );

    // Convert numeric fields to actual numbers (fixes frontend toFixed crash)
    const cleanedRows = result.rows.map(row => ({
      ...row,
      price: Number(row.price) || 0,
      average_rating: Number(row.average_rating) || 0,
      rating_count: Number(row.rating_count) || 0,
      stock_quantity: Number(row.stock_quantity) || 0,
    }));

    res.status(200).json({
      status: 'success',
      count: cleanedRows.length,
      total: parseInt(totalResult.rows[0].count),
      data: cleanedRows
    });
  } catch (err) {
    console.error('Error fetching approved listings:', err.stack);
    res.status(500).json({ status: 'error', message: 'Failed to fetch listings' });
  }
});

// Get single listing by ID - public (used by ListingDetail)
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(`
      SELECT 
        l.id,
        l.user_id,
        l.title,
        l.description,
        l.price,
        l.condition,
        l.whatsapp_phone,
        l.image_urls,
        l.stock_quantity,
        l.category,
        l.average_rating,
        l.rating_count,
        l.created_at,
        u.username,
        u.shop_name,
        u.avatar_url,
        u.cover_image_url
      FROM listings l
      JOIN users u ON l.user_id = u.id
      WHERE l.id = $1
    `, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    const listing = result.rows[0];

    // Convert numeric fields to real numbers
    const cleanedListing = {
      ...listing,
      price: Number(listing.price) || 0,
      average_rating: Number(listing.average_rating) || 0,
      rating_count: Number(listing.rating_count) || 0,
      stock_quantity: Number(listing.stock_quantity) || 0,
    };

    res.json(cleanedListing);
  } catch (err) {
    console.error('Error fetching single listing:', err.stack);
    res.status(500).json({ message: 'Server error' });
  }
});

// Check if current user already rated this listing
router.get('/:id/rating-status', authMiddleware, async (req, res) => {
  const listingId = req.params.id;
  const userId = req.user.userId;

  try {
    const result = await pool.query(
      'SELECT rating FROM ratings WHERE listing_id = $1 AND user_id = $2',
      [listingId, userId]
    );

    if (result.rowCount > 0) {
      return res.json({
        hasRated: true,
        previousRating: Number(result.rows[0].rating) || 0
      });
    }

    res.json({ hasRated: false });
  } catch (err) {
    console.error('Rating status check error:', err.stack);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all ratings received on seller's listings (owner or admin only)
router.get('/users/:userId/ratings', authMiddleware, async (req, res) => {
  const sellerId = req.params.userId;
  const currentUserId = req.user.userId;
  const isAdmin = req.user.role === 'admin';

  if (currentUserId !== parseInt(sellerId) && !isAdmin) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  try {
    const ratings = await pool.query(`
      SELECT 
        r.id,
        r.rating,
        r.comment,
        r.created_at,
        u.username AS rater_username,
        l.title AS listing_title,
        l.id AS listing_id
      FROM ratings r
      JOIN listings l ON r.listing_id = l.id
      JOIN users u ON r.user_id = u.id
      WHERE l.user_id = $1
      ORDER BY r.created_at DESC
    `, [sellerId]);

    // Ensure rating is number
    const cleanedRatings = ratings.rows.map(r => ({
      ...r,
      rating: Number(r.rating) || 0
    }));

    res.json({
      status: 'success',
      count: cleanedRatings.length,
      data: cleanedRatings
    });
  } catch (err) {
    console.error('Error fetching seller ratings:', err.stack);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get listings for a specific user (public approved + private for owner/admin)
router.get('/user/:userId', async (req, res) => {
  const { userId } = req.params;

  const token = req.headers.authorization?.split(' ')[1];
  let currentUserId = null;
  let isAdmin = false;

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      currentUserId = decoded.userId;
      isAdmin = decoded.role === 'admin';
    } catch (err) {
      console.log('Optional token invalid:', err.message);
    }
  }

  const isOwner = currentUserId === parseInt(userId);

  try {
    let query = `
      SELECT 
        id,
        user_id,
        title,
        description,
        price,
        condition,
        whatsapp_phone,
        image_urls,
        stock_quantity,
        category,
        average_rating,
        rating_count,
        status,
        created_at
      FROM listings 
      WHERE user_id = $1
    `;

    const params = [userId];

    if (!isOwner && !isAdmin) {
      query += ` AND status = 'approved'`;
    }

    query += ` ORDER BY created_at DESC`;

    const result = await pool.query(query, params);

    // Convert numerics
    const cleanedRows = result.rows.map(row => ({
      ...row,
      price: Number(row.price) || 0,
      average_rating: Number(row.average_rating) || 0,
      rating_count: Number(row.rating_count) || 0,
      stock_quantity: Number(row.stock_quantity) || 0,
    }));

    res.json({
      status: 'success',
      count: cleanedRows.length,
      data: cleanedRows
    });
  } catch (err) {
    console.error('Error fetching user listings:', err.stack);
    res.status(500).json({ message: 'Server error' });
  }
});

// ────────────────────────────────────────────────
// POST ROUTES (protected)
// ────────────────────────────────────────────────

// Create new listing (pending approval)
router.post('/', authMiddleware, async (req, res) => {
  const {
    title,
    description,
    price,
    condition = 'Used - Good',
    whatsapp_phone,
    image_urls = [],
    stock_quantity = 1,
    category = 'Other'
  } = req.body;

  if (!title?.trim()) return res.status(400).json({ message: 'Title is required' });
  if (!price || isNaN(price) || price <= 0) return res.status(400).json({ message: 'Valid positive price required' });
  if (stock_quantity < 1) return res.status(400).json({ message: 'Stock quantity must be at least 1' });

  try {
    const result = await pool.query(
      `INSERT INTO listings (
        user_id, title, description, price, condition, whatsapp_phone, image_urls,
        stock_quantity, category, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
      RETURNING id, title, status, created_at`,
      [
        req.user.userId, title.trim(), description || null, price, condition,
        whatsapp_phone || null, image_urls, stock_quantity, category
      ]
    );

    res.status(201).json({
      status: 'success',
      message: 'Listing created successfully (pending approval)',
      data: result.rows[0]
    });
  } catch (err) {
    console.error('Error creating listing:', err.stack);
    res.status(500).json({ message: 'Failed to create listing' });
  }
});

// Rating submission endpoint (protected)
router.post('/:id/rating', authMiddleware, async (req, res) => {
  const { rating, comment } = req.body;
  const listingId = req.params.id;
  const userId = req.user.userId;

  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ message: 'Rating must be between 1 and 5' });
  }

  try {
    const listingCheck = await pool.query('SELECT id FROM listings WHERE id = $1', [listingId]);
    if (listingCheck.rowCount === 0) return res.status(404).json({ message: 'Listing not found' });

    const existing = await pool.query(
      'SELECT id FROM ratings WHERE listing_id = $1 AND user_id = $2',
      [listingId, userId]
    );
    if (existing.rowCount > 0) return res.status(400).json({ message: 'You have already rated this listing' });

    await pool.query(
      'INSERT INTO ratings (listing_id, user_id, rating, comment) VALUES ($1, $2, $3, $4)',
      [listingId, userId, rating, comment || null]
    );

    await pool.query(`
      UPDATE listings
      SET 
        rating_count = rating_count + 1,
        average_rating = (SELECT AVG(rating)::numeric(3,2) FROM ratings WHERE listing_id = $1)
      WHERE id = $1
    `, [listingId]);

    res.status(201).json({ message: 'Rating submitted successfully' });
  } catch (err) {
    console.error('Rating submission error:', err.stack);
    res.status(500).json({ message: 'Failed to submit rating' });
  }
});

// ────────────────────────────────────────────────
// PATCH ROUTE (protected - owner only)
// ────────────────────────────────────────────────

router.patch('/:id', authMiddleware, async (req, res) => {
  const { stock_quantity } = req.body;
  const listingId = req.params.id;
  const userId = req.user.userId;

  if (stock_quantity == null || stock_quantity < 0) {
    return res.status(400).json({ message: 'Valid non-negative stock quantity required' });
  }

  try {
    const result = await pool.query(
      'UPDATE listings SET stock_quantity = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
      [stock_quantity, listingId, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Listing not found or not yours' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Stock update error:', err.stack);
    res.status(500).json({ message: 'Failed to update stock' });
  }
});

// ────────────────────────────────────────────────
// DELETE ROUTES (protected)
// ────────────────────────────────────────────────

// Delete listing (owner or admin)
router.delete('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const listingResult = await pool.query('SELECT user_id FROM listings WHERE id = $1', [id]);
    if (listingResult.rowCount === 0) return res.status(404).json({ message: 'Listing not found' });

    const listing = listingResult.rows[0];
    const isOwner = req.user.userId === listing.user_id;
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) return res.status(403).json({ message: 'Permission denied' });

    await pool.query('DELETE FROM listings WHERE id = $1', [id]);
    res.json({ message: 'Listing deleted successfully' });
  } catch (err) {
    console.error('Delete listing error:', err.stack);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete a rating (seller of the listing or admin)
router.delete('/ratings/:ratingId', authMiddleware, async (req, res) => {
  const ratingId = req.params.ratingId;
  const currentUserId = req.user.userId;

  try {
    const ratingInfo = await pool.query(`
      SELECT r.listing_id, l.user_id 
      FROM ratings r
      JOIN listings l ON r.listing_id = l.id
      WHERE r.id = $1
    `, [ratingId]);

    if (ratingInfo.rowCount === 0) return res.status(404).json({ message: 'Rating not found' });

    const listingOwnerId = ratingInfo.rows[0].user_id;

    if (currentUserId !== listingOwnerId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to delete this rating' });
    }

    await pool.query('DELETE FROM ratings WHERE id = $1', [ratingId]);

    await pool.query(`
      UPDATE listings
      SET 
        rating_count = (SELECT COUNT(*) FROM ratings WHERE listing_id = $1),
        average_rating = COALESCE((
          SELECT AVG(rating)::numeric(3,2) FROM ratings WHERE listing_id = $1
        ), 0)
      WHERE id = $1
    `, [ratingInfo.rows[0].listing_id]);

    res.json({ message: 'Rating deleted successfully' });
  } catch (err) {
    console.error('Delete rating error:', err.stack);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;