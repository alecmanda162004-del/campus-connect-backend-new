const express = require('express');
const router  = express.Router();
const pool    = require('../models/db');
const authMiddleware = require('../middleware/auth');
const jwt    = require('jsonwebtoken');
const { notifyNewListing, notifyNewRating } = require('../utils/notifications');

const cleanListing = (row) => ({
  ...row,
  price:              Number(row.price) || 0,
  average_rating:     Number(row.average_rating) || 0,
  rating_count:       Number(row.rating_count) || 0,
  stock_quantity:     Number(row.stock_quantity) || 0,
  image_urls:         Array.isArray(row.image_urls) ? row.image_urls : [],
  variants:           Array.isArray(row.variants)   ? row.variants   : [],
  is_premium:         Boolean(row.is_premium),
});

// ── GET /api/listings
router.get('/', async (req, res) => {
  try {
    const page       = parseInt(req.query.page) || 1;
    const limitParam = req.query.limit;
    const hasSearch  = !!req.query.search?.trim();
    // No limit when searching so results cover all approved listings
    const limit      = hasSearch ? null : (limitParam ? Math.min(parseInt(limitParam), 200) : null);
    const sort       = req.query.sort || 'newest';
    const search     = req.query.search?.trim();
    const category   = req.query.category;
    const minPrice   = req.query.minPrice ? Number(req.query.minPrice) : null;
    const maxPrice   = req.query.maxPrice ? Number(req.query.maxPrice) : null;
    const condition  = req.query.condition;

    // Premium listings always float to the top, then sort within premium/non-premium
    let orderBy = 'l.is_premium DESC NULLS LAST, l.created_at DESC';
    if (sort === 'price-low')  orderBy = 'l.is_premium DESC NULLS LAST, l.price ASC';
    if (sort === 'price-high') orderBy = 'l.is_premium DESC NULLS LAST, l.price DESC';

    const offset       = limit ? (page - 1) * limit : 0;
    let where          = "WHERE l.status = 'approved' AND (l.expires_at IS NULL OR l.expires_at > NOW()) AND l.sold_at IS NULL";
    const filterParams = [];
    let paramIndex     = 1;

    if (search) {
      where += ` AND (l.title ILIKE $${paramIndex} OR l.description ILIKE $${paramIndex})`;
      filterParams.push(`%${search}%`);
      paramIndex++;
    }
    if (category && category !== 'All') {
      where += ` AND l.category = $${paramIndex}`;
      filterParams.push(category);
      paramIndex++;
    }
    if (condition && condition !== 'All') {
      where += ` AND l.condition = $${paramIndex}`;
      filterParams.push(condition);
      paramIndex++;
    }
    if (minPrice !== null) {
      where += ` AND l.price >= $${paramIndex}`;
      filterParams.push(minPrice);
      paramIndex++;
    }
    if (maxPrice !== null) {
      where += ` AND l.price <= $${paramIndex}`;
      filterParams.push(maxPrice);
      paramIndex++;
    }

    let listingsQuery = `
      SELECT l.id, l.user_id, l.title, l.description, l.price, l.condition,
             l.whatsapp_phone, l.image_urls, l.stock_quantity, l.category,
             l.average_rating, l.rating_count, l.variants, l.created_at,
             l.expires_at, l.sold_at, l.status,
             l.is_premium, l.premium_expires_at,
             l.location, l.campus, l.availability, l.price_type, l.tags,
             u.username, u.shop_name, u.is_verified, u.average_rating AS seller_rating, u.seller_rating_count
      FROM listings l
      JOIN users u ON l.user_id = u.id
      ${where}
      ORDER BY ${orderBy}
    `;

    const listingParams = [...filterParams];
    if (limit) {
      listingsQuery += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      listingParams.push(limit, offset);
    }

    const [listingsRes, countRes] = await Promise.all([
      pool.query(listingsQuery, listingParams),
      pool.query(`SELECT COUNT(*) FROM listings l ${where}`, filterParams),
    ]);

    const total = parseInt(countRes.rows[0].count);

    res.json({
      status: 'success',
      data: listingsRes.rows.map(cleanListing),
      pagination: {
        currentPage: page,
        totalItems:  total,
        ...(limit && {
          totalPages: Math.ceil(total / limit),
          hasNext:    page * limit < total,
          hasPrev:    page > 1,
        }),
      },
    });
  } catch (err) {
    console.error('GET /listings error:', err.stack);
    res.status(500).json({ message: 'Failed to fetch listings' });
  }
});

// ── GET /api/listings/categories/popular  (BEFORE /:id)
router.get('/categories/popular', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT category, COUNT(*) AS count
      FROM listings
      WHERE status = 'approved' AND category IS NOT NULL AND category != ''
        AND (expires_at IS NULL OR expires_at > NOW()) AND sold_at IS NULL
      GROUP BY category
      ORDER BY count DESC
      LIMIT 10
    `);
    res.json({ status: 'success', data: result.rows.map((r) => ({ category: r.category, count: parseInt(r.count) })) });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── GET /api/listings/user/:userId  (BEFORE /:id)
router.get('/user/:userId', async (req, res) => {
  const { userId } = req.params;
  const token = req.headers.authorization?.split(' ')[1];
  let currentUserId = null;
  if (token) {
    try { const d = jwt.verify(token, process.env.JWT_SECRET); currentUserId = d.userId; } catch (_) {}
  }
  const isOwner = currentUserId === parseInt(userId);

  try {
    let query = `
      SELECT id, user_id, title, description, price, condition, whatsapp_phone,
             image_urls, stock_quantity, category, average_rating, rating_count,
             status, created_at, expires_at, sold_at, variants
      FROM listings
      WHERE user_id = $1
    `;
    if (!isOwner) query += ` AND status = 'approved'`;
    query += ` ORDER BY created_at DESC`;

    const result = await pool.query(query, [userId]);
    res.json({ status: 'success', count: result.rows.length, data: result.rows.map(cleanListing) });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── GET /api/listings/related/:id  (BEFORE /:id)
router.get('/related/:id', async (req, res) => {
  const SERVICE_CATS = ['Services', 'Food', 'Accommodation'];
  try {
    const listing = await pool.query('SELECT category, user_id FROM listings WHERE id = $1', [req.params.id]);
    if (listing.rowCount === 0) return res.json({ data: [] });

    const { category, user_id } = listing.rows[0];
    const isService = SERVICE_CATS.includes(category);

    let result;
    if (isService) {
      // Services: ONLY same category — never mix food with rooms or unrelated items
      result = await pool.query(
        `SELECT id, title, price, image_urls, category, average_rating, rating_count,
                condition, stock_quantity, is_premium
         FROM listings
         WHERE status = 'approved'
           AND sold_at IS NULL
           AND (expires_at IS NULL OR expires_at > NOW())
           AND id != $1
           AND category = $2
         ORDER BY is_premium DESC NULLS LAST, created_at DESC
         LIMIT 8`,
        [req.params.id, category]
      );
    } else {
      // Regular listings: same category first, exclude service categories
      result = await pool.query(
        `SELECT id, title, price, image_urls, category, average_rating, rating_count,
                condition, stock_quantity, is_premium
         FROM listings
         WHERE status = 'approved'
           AND sold_at IS NULL
           AND (expires_at IS NULL OR expires_at > NOW())
           AND id != $1
           AND category NOT IN ('Services', 'Food', 'Accommodation')
           AND (category = $2 OR user_id = $3)
         ORDER BY
           is_premium DESC NULLS LAST,
           (CASE WHEN category = $2 AND user_id = $3 THEN 0 WHEN category = $2 THEN 1 ELSE 2 END),
           created_at DESC
         LIMIT 8`,
        [req.params.id, category, user_id]
      );
    }

    res.json({ data: result.rows.map(cleanListing) });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── DELETE /api/listings/ratings/:ratingId  (BEFORE /:id)
router.delete('/ratings/:ratingId', authMiddleware, async (req, res) => {
  try {
    const ratingInfo = await pool.query(`
      SELECT r.listing_id, l.user_id
      FROM ratings r JOIN listings l ON r.listing_id = l.id
      WHERE r.id = $1
    `, [req.params.ratingId]);

    if (ratingInfo.rowCount === 0) return res.status(404).json({ message: 'Rating not found' });

    if (req.user.userId !== ratingInfo.rows[0].user_id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    await pool.query('DELETE FROM ratings WHERE id = $1', [req.params.ratingId]);
    await pool.query(`
      UPDATE listings SET
        rating_count   = (SELECT COUNT(*) FROM ratings WHERE listing_id = $1),
        average_rating = COALESCE((SELECT AVG(rating)::numeric(3,2) FROM ratings WHERE listing_id = $1), 0)
      WHERE id = $1
    `, [ratingInfo.rows[0].listing_id]);

    res.json({ message: 'Rating deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── GET /api/listings/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT l.*, u.username, u.shop_name, u.avatar_url, u.is_verified,
             u.seller_rating, u.seller_rating_count
      FROM listings l
      JOIN users u ON l.user_id = u.id
      WHERE l.id = $1 AND l.status = 'approved'
    `, [req.params.id]);

    if (result.rowCount === 0) return res.status(404).json({ message: 'Listing not found' });
    res.json(cleanListing(result.rows[0]));
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── GET /api/listings/:id/rating-status
router.get('/:id/rating-status', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT rating FROM ratings WHERE listing_id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    );
    if (result.rowCount > 0) return res.json({ hasRated: true, previousRating: Number(result.rows[0].rating) });
    res.json({ hasRated: false });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── POST /api/listings
router.post('/', authMiddleware, async (req, res) => {
  const {
    title, description, price, condition = 'Used - Good',
    whatsapp_phone, image_urls = [], stock_quantity = 1,
    category = 'Others', variants = [],
    location: listingLocation, campus, availability, price_type, tags,
  } = req.body;

  if (!title?.trim())                        return res.status(400).json({ message: 'Title is required' });
  if (!price || Number(price) <= 0)          return res.status(400).json({ message: 'Valid price is required' });
  if (Number(stock_quantity) < 1)            return res.status(400).json({ message: 'Stock must be at least 1' });
  if (!Array.isArray(variants))              return res.status(400).json({ message: 'Variants must be an array' });

  const cleanedVariants = variants.filter((v) => {
    const has = (v.color || '').trim() || (v.size || '').trim();
    return has && !isNaN(Number(v.stock)) && Number(v.stock) >= 0;
  });

  try {
    const result = await pool.query(
      `INSERT INTO listings
        (user_id, title, description, price, condition, whatsapp_phone,
         image_urls, stock_quantity, category, variants, status, expires_at,
         location, campus, availability, price_type, tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending', NOW() + INTERVAL '60 days',$11,$12,$13,$14,$15)
       RETURNING id, title, status, created_at, price, category`,
      [req.user.userId, title.trim(), description?.trim() || null,
       Number(price), condition, whatsapp_phone?.trim() || null,
       image_urls, Number(stock_quantity), category, JSON.stringify(cleanedVariants),
       listingLocation?.trim() || null, campus?.trim() || null,
       availability?.trim() || null, price_type || 'fixed',
       Array.isArray(tags) ? tags : []]
    );

    const listing = result.rows[0];

    // Get seller email for future notifications
    const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [req.user.userId]);
    if (userResult.rows[0]) {
      notifyNewListing({ ...listing, seller_email: userResult.rows[0].email });
    }

    res.status(201).json({ status: 'success', message: 'Listing submitted — pending approval', data: listing });
  } catch (err) {
    console.error('POST /listings error:', err.stack);
    res.status(500).json({ message: 'Failed to create listing' });
  }
});

// ── POST /api/listings/:id/rating
router.post('/:id/rating', authMiddleware, async (req, res) => {
  const { rating, comment } = req.body;
  const listingId = req.params.id;
  const userId    = req.user.userId;

  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ message: 'Rating must be 1–5' });

  try {
    const listingCheck = await pool.query(
      'SELECT id, title, user_id FROM listings WHERE id = $1', [listingId]
    );
    if (listingCheck.rowCount === 0) return res.status(404).json({ message: 'Listing not found' });

    const existing = await pool.query(
      'SELECT id FROM ratings WHERE listing_id = $1 AND user_id = $2', [listingId, userId]
    );
    if (existing.rowCount > 0) return res.status(400).json({ message: 'You have already rated this listing' });

    await pool.query(
      'INSERT INTO ratings (listing_id, user_id, rating, comment) VALUES ($1,$2,$3,$4)',
      [listingId, userId, rating, comment?.trim() || null]
    );

    await pool.query(`
      UPDATE listings SET
        rating_count   = rating_count + 1,
        average_rating = (SELECT AVG(rating)::numeric(3,2) FROM ratings WHERE listing_id = $1)
      WHERE id = $1
    `, [listingId]);

    // Update seller-level rating aggregate
    const listing = listingCheck.rows[0];
    await pool.query(`
      UPDATE users SET
        seller_rating       = (SELECT AVG(r.rating)::numeric(3,2) FROM ratings r JOIN listings l ON r.listing_id = l.id WHERE l.user_id = $1),
        seller_rating_count = (SELECT COUNT(*) FROM ratings r JOIN listings l ON r.listing_id = l.id WHERE l.user_id = $1)
      WHERE id = $1
    `, [listing.user_id]);

    // Notify seller
    const sellerResult = await pool.query('SELECT email FROM users WHERE id = $1', [listing.user_id]);
    if (sellerResult.rows[0]) {
      notifyNewRating(sellerResult.rows[0].email, listing, rating);
    }

    res.status(201).json({ message: 'Rating submitted' });
  } catch (err) {
    console.error('POST /:id/rating error:', err.stack);
    res.status(500).json({ message: 'Failed to submit rating' });
  }
});

// ── PATCH /api/listings/:id
router.patch('/:id', authMiddleware, async (req, res) => {
  const { id }   = req.params;
  const userId   = req.user.userId;

  const ALLOWED = ['title','description','price','condition','whatsapp_phone',
                   'image_urls','stock_quantity','category','variants'];
  const updates  = {};
  ALLOWED.forEach((f) => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

  // Handle mark-as-sold
  if (req.body.sold === true) updates.sold_at = new Date();
  if (req.body.sold === false) updates.sold_at = null;

  if (Object.keys(updates).length === 0) return res.status(400).json({ message: 'No valid fields to update' });

  try {
    const ownerCheck = await pool.query('SELECT user_id FROM listings WHERE id = $1', [id]);
    if (ownerCheck.rowCount === 0) return res.status(404).json({ message: 'Listing not found' });
    if (ownerCheck.rows[0].user_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const setParts = [];
    const values   = [];
    let idx = 1;

    for (const [key, val] of Object.entries(updates)) {
      if (key === 'price')          { setParts.push(`price = $${idx}`); values.push(Number(val)); }
      else if (key === 'stock_quantity') { setParts.push(`stock_quantity = $${idx}`); values.push(Number(val)); }
      else if (key === 'variants')  { setParts.push(`variants = $${idx}`); values.push(JSON.stringify(Array.isArray(val) ? val : [])); }
      else if (key === 'sold_at')   { setParts.push(`sold_at = $${idx}`); values.push(val); }
      else                          { setParts.push(`${key} = $${idx}`); values.push(val); }
      idx++;
    }

    setParts.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query(
      `UPDATE listings SET ${setParts.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    res.json(cleanListing(result.rows[0]));
  } catch (err) {
    console.error('PATCH /listings/:id error:', err.stack);
    res.status(500).json({ message: 'Failed to update listing' });
  }
});

// ── DELETE /api/listings/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const check = await pool.query('SELECT user_id FROM listings WHERE id = $1', [req.params.id]);
    if (check.rowCount === 0) return res.status(404).json({ message: 'Listing not found' });
    if (check.rows[0].user_id !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Permission denied' });
    }
    await pool.query('DELETE FROM listings WHERE id = $1', [req.params.id]);
    res.json({ message: 'Listing deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});


// ── PATCH /api/listings/:id — edit listing (owner only)
router.patch('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId;

  const {
    title, description, price, condition, whatsapp_phone,
    stock_quantity, category, image_urls, variants,
    location: listingLocation, campus, availability, price_type,
  } = req.body;

  try {
    // Verify ownership
    const check = await pool.query('SELECT user_id FROM listings WHERE id = $1', [id]);
    if (check.rowCount === 0) return res.status(404).json({ message: 'Listing not found' });
    if (Number(check.rows[0].user_id) !== Number(userId) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const result = await pool.query(
      `UPDATE listings SET
        title          = COALESCE($1, title),
        description    = COALESCE($2, description),
        price          = COALESCE($3, price),
        condition      = COALESCE($4, condition),
        whatsapp_phone = COALESCE($5, whatsapp_phone),
        stock_quantity = COALESCE($6, stock_quantity),
        category       = COALESCE($7, category),
        image_urls     = COALESCE($8, image_urls),
        location       = $9,
        campus         = $10,
        availability   = $11,
        price_type     = COALESCE($12, price_type),
        updated_at     = NOW()
       WHERE id = $13
       RETURNING id, title, status, price, category`,
      [
        title?.trim()      || null,
        description?.trim()|| null,
        price ? Number(price) : null,
        condition          || null,
        whatsapp_phone?.trim() || null,
        stock_quantity ? Number(stock_quantity) : null,
        category           || null,
        image_urls && image_urls.length > 0 ? image_urls : null,
        listingLocation?.trim() || null,
        campus?.trim()     || null,
        availability?.trim()|| null,
        price_type         || null,
        id,
      ]
    );

    res.json({ success: true, message: 'Listing updated', data: result.rows[0] });
  } catch (err) {
    console.error('PATCH /listings/:id error:', err.message);
    res.status(500).json({ message: 'Failed to update listing' });
  }
});

module.exports = router;

