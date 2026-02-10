const express = require('express');
const router = express.Router();
const pool = require('../models/db'); // adjust path if your DB file is elsewhere
const authMiddleware = require('../middleware/auth'); // adjust if needed

// POST /api/feedback - Submit new feedback (logged-in users only)
router.post('/', authMiddleware, async (req, res) => {
  const { rating, comment } = req.body;
  const userId = req.user.userId; // from JWT middleware

  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ message: 'Rating must be between 1 and 5' });
  }

  try {
    await pool.query(
      'INSERT INTO feedback (user_id, rating, comment) VALUES ($1, $2, $3)',
      [userId, rating, comment || null]
    );
    res.status(201).json({ message: 'Feedback submitted successfully' });
  } catch (err) {
    console.error('Error saving feedback:', err);
    res.status(500).json({ message: 'Failed to submit feedback' });
  }
});

// GET /api/feedback - Get all feedback (admin only)
router.get('/', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access only' });
  }

  try {
    const result = await pool.query(
      `SELECT f.id, f.rating, f.comment, f.created_at, u.username
       FROM feedback f
       JOIN users u ON f.user_id = u.id
       ORDER BY f.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching feedback:', err);
    res.status(500).json({ message: 'Failed to load feedback' });
  }
});

module.exports = router;