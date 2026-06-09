const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const authMiddleware = require('../middleware/auth');

// FIX: /profile and /me MUST come before /:id to avoid wildcard capture

// PUT /api/users/profile — update own profile
router.put('/profile', authMiddleware, async (req, res) => {
  const { shop_name, bio, cover_image_url, avatar_url } = req.body;
  const userId = req.user.userId;

  try {
    await pool.query(
      'UPDATE users SET shop_name = $1, bio = $2, cover_image_url = $3, avatar_url = $4 WHERE id = $5',
      [shop_name?.trim() || null, bio?.trim() || null, cover_image_url || null, avatar_url || null, userId]
    );

    res.json({ status: 'success', message: 'Profile updated successfully' });
  } catch (err) {
    console.error('PUT /users/profile error:', err);
    res.status(500).json({ status: 'error', message: 'Failed to update profile' });
  }
});

// DELETE /api/users/me — delete own account
router.delete('/me', authMiddleware, async (req, res) => {
  const userId = req.user.userId;

  try {
    await pool.query('DELETE FROM ratings WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM listings WHERE user_id = $1', [userId]);

    const deleteResult = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING id',
      [userId]
    );

    if (deleteResult.rowCount === 0) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    res.json({ status: 'success', message: 'Account permanently deleted' });
  } catch (err) {
    console.error('DELETE /users/me error:', err.stack);
    res.status(500).json({ status: 'error', message: 'Failed to delete account' });
  }
});

// GET /api/users/:id — public profile
router.get('/:id', async (req, res) => {
  const userId = parseInt(req.params.id, 10);

  if (isNaN(userId) || userId <= 0) {
    return res.status(400).json({ status: 'error', message: 'Invalid user ID' });
  }

  try {
    const result = await pool.query(
      'SELECT id, username, shop_name, bio, cover_image_url, avatar_url, whatsapp_phone FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    res.json({ status: 'success', data: result.rows[0] });
  } catch (err) {
    console.error('GET /users/:id error:', err.stack);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

// PUT /api/users/:id/cover — admin only: update any seller's cover image
router.put('/:id/cover', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ status: 'error', message: 'Admin access only' });
  }

  const userId = parseInt(req.params.id, 10);
  if (isNaN(userId) || userId <= 0) {
    return res.status(400).json({ status: 'error', message: 'Invalid user ID' });
  }

  const { cover_image_url } = req.body;

  try {
    await pool.query('UPDATE users SET cover_image_url = $1 WHERE id = $2', [cover_image_url, userId]);
    res.json({ status: 'success', message: 'Cover image updated' });
  } catch (err) {
    console.error('PUT /users/:id/cover error:', err);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

module.exports = router;
