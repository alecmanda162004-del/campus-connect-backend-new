const express = require('express');
const router  = express.Router();
const pool    = require('../models/db');
const authMiddleware = require('../middleware/auth');
const { notifyNewListing } = require('../utils/notifications');

const cleanAuction = (row) => ({
  ...row,
  start_price:   Number(row.start_price)   || 0,
  current_bid:   Number(row.current_bid)   || null,
  reserve_price: Number(row.reserve_price) || null,
  bid_count:     Number(row.bid_count)     || 0,
  time_left:     Math.max(0, new Date(row.ends_at).getTime() - Date.now()),
  is_ended:      new Date(row.ends_at) < new Date() || row.status !== 'active',
});

// GET /api/auctions — list active auctions
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        a.*,
        l.title, l.description, l.image_urls, l.category,
        u.username AS seller_name, u.shop_name, u.is_verified,
        w.username AS winner_name
      FROM auctions a
      JOIN listings l ON a.listing_id = l.id
      JOIN users    u ON a.seller_id  = u.id
      LEFT JOIN users w ON a.winner_id = w.id
      WHERE a.status = 'active' AND a.ends_at > NOW()
      ORDER BY a.ends_at ASC
    `);
    res.json({ success: true, count: result.rows.length, data: result.rows.map(cleanAuction) });
  } catch (err) {
    console.error('GET /auctions error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/auctions/ended — recently ended
router.get('/ended', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.*, l.title, l.image_urls, l.category,
             u.username AS seller_name, w.username AS winner_name
      FROM auctions a
      JOIN listings l ON a.listing_id = l.id
      JOIN users    u ON a.seller_id  = u.id
      LEFT JOIN users w ON a.winner_id = w.id
      WHERE a.status = 'ended'
      ORDER BY a.ends_at DESC
      LIMIT 20
    `);
    res.json({ success: true, data: result.rows.map(cleanAuction) });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/auctions/:id — single auction with bid history
router.get('/:id', async (req, res) => {
  try {
    const [auctionRes, bidsRes] = await Promise.all([
      pool.query(`
        SELECT a.*, l.title, l.description, l.image_urls, l.category, l.whatsapp_phone,
               u.username AS seller_name, u.shop_name, u.is_verified, u.id AS seller_user_id,
               w.username AS winner_name
        FROM auctions a
        JOIN listings l ON a.listing_id = l.id
        JOIN users    u ON a.seller_id  = u.id
        LEFT JOIN users w ON a.winner_id = w.id
        WHERE a.id = $1
      `, [req.params.id]),
      pool.query(`
        SELECT ab.amount, ab.created_at, u.username
        FROM auction_bids ab
        JOIN users u ON ab.bidder_id = u.id
        WHERE ab.auction_id = $1
        ORDER BY ab.amount DESC
        LIMIT 20
      `, [req.params.id]),
    ]);

    if (auctionRes.rowCount === 0) return res.status(404).json({ message: 'Auction not found' });

    res.json({
      ...cleanAuction(auctionRes.rows[0]),
      image_urls: auctionRes.rows[0].image_urls || [],
      bids: bidsRes.rows.map((b) => ({ ...b, amount: Number(b.amount) })),
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/auctions — create auction (seller only)
router.post('/', authMiddleware, async (req, res) => {
  const { listing_id, start_price, reserve_price, duration_hours = 24 } = req.body;
  const sellerId = req.user.userId;

  if (!listing_id || !start_price || Number(start_price) <= 0) {
    return res.status(400).json({ message: 'listing_id and start_price are required' });
  }
  if (duration_hours < 1 || duration_hours > 168) {
    return res.status(400).json({ message: 'Duration must be between 1 and 168 hours (7 days)' });
  }

  try {
    // Verify listing belongs to seller
    const listingCheck = await pool.query(
      'SELECT id, title FROM listings WHERE id = $1 AND user_id = $2',
      [listing_id, sellerId]
    );
    if (listingCheck.rowCount === 0) {
      return res.status(404).json({ message: 'Listing not found or you do not own it' });
    }

    // Check no active auction for this listing
    const existingAuction = await pool.query(
      "SELECT id FROM auctions WHERE listing_id = $1 AND status = 'active'",
      [listing_id]
    );
    if (existingAuction.rowCount > 0) {
      return res.status(400).json({ message: 'This listing already has an active auction' });
    }

    const endsAt = new Date(Date.now() + duration_hours * 60 * 60 * 1000);

    const result = await pool.query(
      `INSERT INTO auctions (listing_id, seller_id, start_price, reserve_price, ends_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [listing_id, sellerId, Number(start_price), reserve_price ? Number(reserve_price) : null, endsAt]
    );

    res.status(201).json({ success: true, message: 'Auction created', data: cleanAuction(result.rows[0]) });
  } catch (err) {
    console.error('POST /auctions error:', err);
    res.status(500).json({ message: 'Failed to create auction' });
  }
});

// POST /api/auctions/:id/bid — place a bid
router.post('/:id/bid', authMiddleware, async (req, res) => {
  const { amount } = req.body;
  const bidderId   = req.user.userId;
  const auctionId  = req.params.id;

  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ message: 'Valid bid amount required' });
  }

  try {
    const auction = await pool.query(
      "SELECT * FROM auctions WHERE id = $1 AND status = 'active' AND ends_at > NOW()",
      [auctionId]
    );
    if (auction.rowCount === 0) {
      return res.status(404).json({ message: 'Auction not found or has ended' });
    }

    const a = auction.rows[0];

    if (Number(a.seller_id) === bidderId) {
      return res.status(400).json({ message: 'You cannot bid on your own auction' });
    }

    const minBid = Number(a.current_bid || a.start_price);
    const minRequired = a.current_bid ? minBid + 10 : minBid;

    if (Number(amount) < minRequired) {
      return res.status(400).json({
        message: a.current_bid
          ? `Bid must be at least K${minRequired.toLocaleString()} (current bid + K10)`
          : `Bid must be at least K${minRequired.toLocaleString()} (starting price)`,
      });
    }

    // Insert bid and update auction
    await pool.query('BEGIN');
    await pool.query(
      'INSERT INTO auction_bids (auction_id, bidder_id, amount) VALUES ($1, $2, $3)',
      [auctionId, bidderId, Number(amount)]
    );
    await pool.query(
      'UPDATE auctions SET current_bid = $1, bid_count = bid_count + 1 WHERE id = $2',
      [Number(amount), auctionId]
    );
    await pool.query('COMMIT');

    // Return updated auction
    const updated = await pool.query('SELECT * FROM auctions WHERE id = $1', [auctionId]);
    res.json({ success: true, message: 'Bid placed!', data: cleanAuction(updated.rows[0]) });
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => {});
    console.error('POST /auctions/:id/bid error:', err);
    res.status(500).json({ message: 'Failed to place bid' });
  }
});

// POST /api/auctions/:id/end — seller ends auction early
router.post('/:id/end', authMiddleware, async (req, res) => {
  try {
    const auction = await pool.query(
      'SELECT * FROM auctions WHERE id = $1 AND seller_id = $2',
      [req.params.id, req.user.userId]
    );
    if (auction.rowCount === 0) return res.status(404).json({ message: 'Auction not found' });

    // Find highest bidder
    const topBid = await pool.query(
      'SELECT bidder_id, amount FROM auction_bids WHERE auction_id = $1 ORDER BY amount DESC LIMIT 1',
      [req.params.id]
    );

    const winnerId = topBid.rows[0]?.bidder_id || null;
    const finalBid = topBid.rows[0]?.amount    || null;

    await pool.query(
      "UPDATE auctions SET status = 'ended', winner_id = $1, current_bid = COALESCE($2, current_bid) WHERE id = $3",
      [winnerId, finalBid, req.params.id]
    );

    res.json({ success: true, message: winnerId ? 'Auction ended — winner found' : 'Auction ended — no bids' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Cron-like: auto-end expired auctions (called by a scheduled job or on each request)
router.post('/system/close-expired', async (req, res) => {
  try {
    const expired = await pool.query(
      "SELECT id FROM auctions WHERE status = 'active' AND ends_at <= NOW()"
    );

    for (const { id } of expired.rows) {
      const topBid = await pool.query(
        'SELECT bidder_id FROM auction_bids WHERE auction_id = $1 ORDER BY amount DESC LIMIT 1',
        [id]
      );
      const winnerId = topBid.rows[0]?.bidder_id || null;
      await pool.query(
        "UPDATE auctions SET status = 'ended', winner_id = $1 WHERE id = $2",
        [winnerId, id]
      );
    }

    res.json({ closed: expired.rows.length });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
