// backend/routes/admin.js
const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const authMiddleware = require('../middleware/auth');  // reuse your auth middleware

// GET all pending listings (admin only)
router.get('/pending', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        id, title, description, price, condition, whatsapp_phone, image_url, created_at
       FROM listings 
       WHERE status = 'pending' 
       ORDER BY created_at DESC`
    );

    res.status(200).json({
      status: 'success',
      count: result.rows.length,
      data: result.rows
    });
  } catch (err) {
    console.error('Error fetching pending listings:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH to update status (approve or reject)
router.patch('/listings/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;  // 'approved' or 'rejected'

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status value' });
  }

  try {
    const result = await pool.query(
      'UPDATE listings SET status = $1 WHERE id = $2 RETURNING id, title, status',
      [status, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    res.json({
      message: `Listing ${status}`,
      data: result.rows[0]
    });
  } catch (err) {
    console.error('Error updating listing status:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;