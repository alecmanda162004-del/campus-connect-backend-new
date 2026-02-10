const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const authMiddleware = require('../middleware/auth');
const jwt = require('jsonwebtoken');

// GET user public profile (safe version)
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  const userId = parseInt(id, 10);
  if (isNaN(userId) || userId <= 0) {
    return res.status(400).json({
      status: 'error',
      message: 'Invalid user ID (must be a positive number)'
    });
  }

  try {
    const result = await pool.query(
      'SELECT id, username, shop_name, bio, cover_image_url, avatar_url, whatsapp_phone FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    res.json({
      status: 'success',
      data: result.rows[0]
    });
  } catch (err) {
    console.error('Error fetching user profile:', err.stack);
    res.status(500).json({ status: 'error', message: 'Server error while fetching user profile' });
  }
});

// PUT update own profile (shop name, bio, cover image) – authenticated user only
router.put('/profile', authMiddleware, async (req, res) => {
  const { shop_name, bio, cover_image_url, avatar_url } = req.body;
  const userId = req.user.userId;

  try {
    await pool.query(
      'UPDATE users SET shop_name = $1, bio = $2, cover_image_url = $3, avatar_url = $4 WHERE id = $5',
      [shop_name || null, bio || null, cover_image_url || null, avatar_url || null, userId]
    );

    res.json({
      status: 'success',
      message: 'Profile updated successfully'
    });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ status: 'error', message: 'Failed to update profile' });
  }
});

// PUT change any seller's cover image – admin only
router.put('/:id/cover', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ status: 'error', message: 'Admin access only' });
  }

  const { id } = req.params;
  const { cover_image_url } = req.body;

  const userId = parseInt(id, 10);
  if (isNaN(userId) || userId <= 0) {
    return res.status(400).json({ status: 'error', message: 'Invalid user ID' });
  }

  try {
    await pool.query(
      'UPDATE users SET cover_image_url = $1 WHERE id = $2',
      [cover_image_url, userId]
    );

    res.json({ status: 'success', message: 'Cover image updated' });
  } catch (err) {
    console.error('Cover update error:', err);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

// ────────────────────────────────────────────────
// NEW: DELETE own account (full deletion)
// ────────────────────────────────────────────────
router.delete('/me', authMiddleware, async (req, res) => {
  const userId = req.user.userId;

  try {
    // Step 1: Delete dependent data (ratings, listings)
    // If your DB has ON DELETE CASCADE, you can skip these
    await pool.query('DELETE FROM ratings WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM listings WHERE user_id = $1', [userId]);

    // Step 2: Delete the user account
    const deleteResult = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [userId]);

    if (deleteResult.rowCount === 0) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    res.json({
      status: 'success',
      message: 'Your account and all associated data have been permanently deleted.'
    });
  } catch (err) {
    console.error('Account deletion error:', err.stack);
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete account. Please try again later.'
    });
  }
});

module.exports = router;