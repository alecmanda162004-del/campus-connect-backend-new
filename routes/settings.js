const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const authMiddleware = require('../middleware/auth');

// GET current hero image (public - single fallback)
router.get('/hero', async (req, res) => {
  try {
    const result = await pool.query('SELECT hero_image_url FROM app_settings WHERE id = 1');
    if (result.rows.length === 0) {
      return res.json({ hero_image_url: 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=1920' });
    }
    res.json({ hero_image_url: result.rows[0].hero_image_url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT update single hero image (admin only)
router.put('/hero', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access only' });
  }

  const { hero_image_url } = req.body;

  try {
    await pool.query(
      'UPDATE app_settings SET hero_image_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
      [hero_image_url]
    );
    res.json({ message: 'Hero image updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update hero image' });
  }
});

// NEW: GET hero carousel images (public - array)
router.get('/hero-images', async (req, res) => {
  try {
    const result = await pool.query('SELECT hero_image_urls FROM app_settings WHERE id = 1');
    const urls = result.rows[0]?.hero_image_urls || [];
    res.json({ hero_image_urls: Array.isArray(urls) ? urls : [] });
  } catch (err) {
    console.error('Error fetching hero carousel:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// NEW: PUT update hero carousel images (admin only)
router.put('/hero-images', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access only' });
  }

  const { hero_image_urls } = req.body;

  if (!Array.isArray(hero_image_urls)) {
    return res.status(400).json({ message: 'hero_image_urls must be an array of URLs' });
  }

  try {
    await pool.query(
      'UPDATE app_settings SET hero_image_urls = $1, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
      [hero_image_urls]
    );
    res.json({ message: 'Hero carousel updated successfully' });
  } catch (err) {
    console.error('Error updating hero carousel:', err);
    res.status(500).json({ message: 'Failed to update hero carousel' });
  }
});

module.exports = router;