const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const authMiddleware = require('../middleware/auth');

const FALLBACK_HERO = 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=1920&q=80';

// GET /api/settings/hero-images
router.get('/hero-images', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT value FROM app_settings WHERE key = 'hero_image_urls'"
    );
    let urls = [];
    if (result.rows[0]?.value) {
      try { urls = JSON.parse(result.rows[0].value); } catch (_) {}
    }
    res.json({ hero_image_urls: Array.isArray(urls) && urls.length > 0 ? urls : [FALLBACK_HERO] });
  } catch (err) {
    console.error('GET /settings/hero-images error:', err);
    res.json({ hero_image_urls: [FALLBACK_HERO] });
  }
});

// PUT /api/settings/hero-images — admin only
router.put('/hero-images', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access only' });
  }
  const { hero_image_urls } = req.body;
  if (!Array.isArray(hero_image_urls)) {
    return res.status(400).json({ message: 'hero_image_urls must be an array' });
  }
  try {
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('hero_image_urls', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(hero_image_urls)]
    );
    res.json({ message: 'Hero carousel updated successfully' });
  } catch (err) {
    console.error('PUT /settings/hero-images error:', err);
    res.status(500).json({ message: 'Failed to update hero carousel' });
  }
});

// GET /api/settings/hero (legacy)
router.get('/hero', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT value FROM app_settings WHERE key = 'hero_image_url'"
    );
    res.json({ hero_image_url: result.rows[0]?.value || FALLBACK_HERO });
  } catch (err) {
    res.json({ hero_image_url: FALLBACK_HERO });
  }
});

module.exports = router;