// routes/team.js
const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const authMiddleware = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin');

// GET /api/team - Fetch all team members (public endpoint)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, role, bio, image, "order", created_at, updated_at 
       FROM team_members 
       ORDER BY "order" ASC, id ASC`
    );

    res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (err) {
    console.error('Error fetching team members:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch team members',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
});

// GET /api/team/:id - Fetch single team member (public, useful for edit preview)
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT id, name, role, bio, image, "order", created_at, updated_at 
       FROM team_members 
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Team member not found',
      });
    }

    res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (err) {
    console.error('Error fetching team member:', err.message);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

// POST /api/team - Create new team member (admin only)
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  const { name, role, bio, image, order = 0 } = req.body;

  // Basic validation
  if (!name?.trim() || !role?.trim() || !image?.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Name, role, and image URL are required',
    });
  }

  if (name.length > 100 || role.length > 100) {
    return res.status(400).json({
      success: false,
      message: 'Name or role too long (max 100 characters)',
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO team_members (name, role, bio, image, "order", created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING id, name, role, bio, image, "order", created_at, updated_at`,
      [name.trim(), role.trim(), bio?.trim() || '', image.trim(), parseInt(order) || 0]
    );

    res.status(201).json({
      success: true,
      message: 'Team member created successfully',
      data: result.rows[0],
    });
  } catch (err) {
    console.error('Error creating team member:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to create team member',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
});

// PUT /api/team/:id - Update existing team member (admin only)
router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;
  const { name, role, bio, image, order } = req.body;

  if (!name?.trim() || !role?.trim() || !image?.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Name, role, and image URL are required',
    });
  }

  try {
    const result = await pool.query(
      `UPDATE team_members 
       SET name = $1, role = $2, bio = $3, image = $4, "order" = $5, updated_at = NOW()
       WHERE id = $6
       RETURNING id, name, role, bio, image, "order", created_at, updated_at`,
      [name.trim(), role.trim(), bio?.trim() || '', image.trim(), parseInt(order) || 0, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Team member not found',
      });
    }

    res.json({
      success: true,
      message: 'Team member updated successfully',
      data: result.rows[0],
    });
  } catch (err) {
    console.error('Error updating team member:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to update team member',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
});

// DELETE /api/team/:id - Delete team member (admin only)
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM team_members WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Team member not found',
      });
    }

    res.json({
      success: true,
      message: 'Team member deleted successfully',
    });
  } catch (err) {
    console.error('Error deleting team member:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to delete team member',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
});

module.exports = router;