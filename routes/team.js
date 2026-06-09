const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const authMiddleware = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin');

// GET /api/team — public
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, role, bio, image, created_at
       FROM team_members
       ORDER BY id ASC`
    );
    res.status(200).json({ success: true, count: result.rows.length, data: result.rows });
  } catch (err) {
    console.error('GET /team error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch team members' });
  }
});

// GET /api/team/:id — public
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, role, bio, image, created_at FROM team_members WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Team member not found' });
    }
    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/team — admin only
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  const { name, role, bio, image } = req.body;

  if (!name?.trim() || !role?.trim()) {
    return res.status(400).json({ success: false, message: 'Name and role are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO team_members (name, role, bio, image, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, name, role, bio, image, created_at`,
      [name.trim(), role.trim(), bio?.trim() || '', image?.trim() || '']
    );
    res.status(201).json({ success: true, message: 'Team member created', data: result.rows[0] });
  } catch (err) {
    console.error('POST /team error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to create team member' });
  }
});

// PUT /api/team/:id — admin only
router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { name, role, bio, image } = req.body;

  if (!name?.trim() || !role?.trim()) {
    return res.status(400).json({ success: false, message: 'Name and role are required' });
  }

  try {
    const result = await pool.query(
      `UPDATE team_members
       SET name = $1, role = $2, bio = $3, image = $4
       WHERE id = $5
       RETURNING id, name, role, bio, image, created_at`,
      [name.trim(), role.trim(), bio?.trim() || '', image?.trim() || '', req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Team member not found' });
    res.json({ success: true, message: 'Team member updated', data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update team member' });
  }
});

// DELETE /api/team/:id — admin only
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM team_members WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Team member not found' });
    res.json({ success: true, message: 'Team member deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete team member' });
  }
});

module.exports = router;
