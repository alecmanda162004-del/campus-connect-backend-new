const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const authMiddleware = require('../middleware/auth');
const jwt = require('jsonwebtoken');

// ── Helper: Clean listing data (always return arrays, convert numbers) ──
const cleanListing = (row) => ({
  ...row,
  price: Number(row.price) || 0,
  average_rating: Number(row.average_rating) || 0,
  rating_count: Number(row.rating_count) || 0,
  stock_quantity: Number(row.stock_quantity) || 0,
  image_urls: Array.isArray(row.image_urls) ? row.image_urls : [],
  variants: Array.isArray(row.variants) ? row.variants : [],
});

// ────────────────────────────────────────────────
// PUBLIC ROUTES
// ────────────────────────────────────────────────

// GET /api/listings
// Paginated, sorted, searchable, filterable marketplace listings
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 24;
    const sort = req.query.sort || 'newest';
    const search = req.query.search?.trim();
    const category = req.query.category;

    if (page < 1 || limit < 1 || limit > 100) {
      return res.status(400).json({ message: 'Invalid page or limit' });
    }

    let orderBy = 'l.created_at DESC';
    if (sort === 'price-low') orderBy = 'l.price ASC';
    if (sort === 'price-high') orderBy = 'l.price DESC';

    const offset = (page - 1) * limit;

    let where = "WHERE l.status = 'approved'";
    const params = [];
    let paramIndex = 1;

    if (search) {
      where += ` AND (l.title ILIKE $${paramIndex} OR l.description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (category && category !== 'All') {
      where += ` AND l.category = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }

    const listingsQuery = `
      SELECT 
        l.id, l.user_id, l.title, l.description, l.price, l.condition, l.whatsapp_phone,
        l.image_urls, l.stock_quantity, l.category, l.average_rating, l.rating_count,
        l.variants,
        l.created_at,
        u.username, u.shop_name
      FROM listings l
      JOIN users u ON l.user_id = u.id
      ${where}
      ORDER BY ${orderBy}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);

    const totalQuery = `
      SELECT COUNT(*) 
      FROM listings l
      ${where.replace('l.', '')}
    `;
    const totalParams = params.slice(0, -2);

    const [listingsRes, totalRes] = await Promise.all([
      pool.query(listingsQuery, params),
      pool.query(totalQuery, totalParams)
    ]);

    const listings = listingsRes.rows.map(cleanListing);
    const total = parseInt(totalRes.rows[0].count);

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
    res.status(500).json({ message: 'Failed to fetch listings' });
  }
});

// GET /api/listings/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(`
      SELECT 
        l.*,
        u.username,
        u.shop_name,
        u.avatar_url,
        u.cover_image_url
      FROM listings l
      JOIN users u ON l.user_id = u.id
      WHERE l.id = $1 AND l.status = 'approved'
    `, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Listing not found or not approved' });
    }

    res.json(cleanListing(result.rows[0]));
  } catch (err) {
    console.error('Error fetching listing:', err.stack);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/listings/categories/popular
router.get('/categories/popular', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT category, COUNT(*) as count
      FROM listings
      WHERE status = 'approved' AND category IS NOT NULL AND category != ''
      GROUP BY category
      ORDER BY count DESC
      LIMIT 10
    `);

    res.json({
      status: 'success',
      data: result.rows.map(r => ({
        category: r.category,
        count: parseInt(r.count)
      }))
    });
  } catch (err) {
    console.error('Error fetching popular categories:', err.stack);
    res.status(500).json({ message: 'Server error' });
  }
});

// ────────────────────────────────────────────────
// PROTECTED ROUTES
// ────────────────────────────────────────────────

// GET /api/listings/:id/rating-status
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

// GET /api/listings/users/:userId/ratings
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
        r.id, r.rating, r.comment, r.created_at,
        u.username AS rater_username,
        l.title AS listing_title, l.id AS listing_id
      FROM ratings r
      JOIN listings l ON r.listing_id = l.id
      JOIN users u ON r.user_id = u.id
      WHERE l.user_id = $1
      ORDER BY r.created_at DESC
    `, [sellerId]);

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

// GET /api/listings/user/:userId
router.get('/user/:userId', async (req, res) => {
  const { userId } = req.params;

  const token = req.headers.authorization?.split(' ')[1];
  let currentUserId = null;

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      currentUserId = decoded.userId;
    } catch (err) {
      console.log('Optional token invalid:', err.message);
    }
  }

  const isOwner = currentUserId === parseInt(userId);

  try {
    let query = `
      SELECT 
        id, user_id, title, description, price, condition, whatsapp_phone,
        image_urls, stock_quantity, category, average_rating, rating_count,
        status, created_at,
        variants
      FROM listings 
      WHERE user_id = $1
    `;
    const params = [userId];

    if (!isOwner) {
      query += ` AND status = 'approved'`;
    }

    query += ` ORDER BY created_at DESC`;

    const result = await pool.query(query, params);

    const cleanedRows = result.rows.map(cleanListing);

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

// POST /api/listings
router.post('/', authMiddleware, async (req, res) => {
  const {
    title,
    description,
    price,
    condition = 'Used - Good',
    whatsapp_phone,
    image_urls = [],
    stock_quantity = 1,
    category = 'Other',
    variants = []
  } = req.body;

  if (!title?.trim()) return res.status(400).json({ message: 'Title is required' });
  if (!price || isNaN(price) || price <= 0) return res.status(400).json({ message: 'Valid positive price required' });
  if (stock_quantity < 1) return res.status(400).json({ message: 'Stock quantity must be at least 1' });

  if (!Array.isArray(variants)) {
    return res.status(400).json({ message: 'Variants must be an array' });
  }

  const cleanedVariants = variants.filter(v => {
    const hasOption = (v.color || '').trim() || (v.size || '').trim();
    const stockValid = Number(v.stock) >= 0 && !isNaN(Number(v.stock));
    return hasOption && stockValid;
  });

  try {
    const result = await pool.query(
      `INSERT INTO listings (
        user_id, title, description, price, condition, whatsapp_phone, image_urls,
        stock_quantity, category, variants, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
      RETURNING id, title, status, created_at`,
      [
        req.user.userId, title.trim(), description || null, price, condition,
        whatsapp_phone || null, image_urls, stock_quantity, category, cleanedVariants
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

// POST /api/listings/:id/rating
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

// PATCH /api/listings/:id
router.patch('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId;

  const allowedFields = [
    'title',
    'description',
    'price',
    'condition',
    'whatsapp_phone',
    'image_url',
    'image_urls',
    'stock_quantity',
    'category',
    'variants'
  ];

  const updates = {};
  allowedFields.forEach(field => {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  });

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ message: 'No valid fields provided for update' });
  }

  // Validation
  if ('price' in updates) {
    const priceVal = Number(updates.price);
    if (isNaN(priceVal) || priceVal <= 0) {
      return res.status(400).json({ message: 'Price must be a positive number' });
    }
    updates.price = priceVal;
  }

  if ('stock_quantity' in updates) {
    const stockVal = Number(updates.stock_quantity);
    if (isNaN(stockVal) || stockVal < 0) {
      return res.status(400).json({ message: 'Stock quantity cannot be negative' });
    }
    updates.stock_quantity = stockVal;
  }

  try {
    // Check ownership
    const ownershipCheck = await pool.query(
      'SELECT user_id FROM listings WHERE id = $1',
      [id]
    );

    if (ownershipCheck.rowCount === 0) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    if (ownershipCheck.rows[0].user_id !== userId) {
      return res.status(403).json({ message: 'You are not authorized to edit this listing' });
    }

    // Build dynamic UPDATE
    const setParts = [];
    const values = [];
    let index = 1;

    for (const [key, rawValue] of Object.entries(updates)) {
      let value = rawValue;

      if (key === 'variants') {
        if (!Array.isArray(value)) {
          return res.status(400).json({ message: 'Variants must be an array' });
        }

        value = value.filter(v => {
          const hasOption = (v.color || '').trim() || (v.size || '').trim();
          const stockValid = Number(v.stock) >= 0 && !isNaN(Number(v.stock));
          return hasOption && stockValid;
        });

        value = JSON.stringify(value);
      }

      setParts.push(`${key} = $${index}`);
      values.push(value);
      index++;
    }

    values.push(id);

    const queryText = `
      UPDATE listings
      SET ${setParts.join(', ')}
      WHERE id = $${index}
      RETURNING *
    `;

    const result = await pool.query(queryText, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    res.json(cleanListing(result.rows[0]));
  } catch (err) {
    console.error('PATCH /listings/:id failed:', {
      error: err.message,
      stack: err.stack,
      receivedBody: req.body,
      id,
      userId
    });
    res.status(500).json({ 
      message: 'Failed to update listing',
      error: err.message 
    });
  }
});

// DELETE /api/listings/:id
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

// DELETE /api/listings/ratings/:ratingId
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