const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../models/db');

const signToken = (user) =>
  jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, email, password, whatsapp_phone } = req.body;

  if (!username?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ message: 'Username, email, and password are required' });
  }

  if (!email.includes('@')) {
    return res.status(400).json({ message: 'Invalid email format' });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    // FIX: include role in RETURNING so the JWT has the correct role
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, whatsapp_phone)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, whatsapp_phone, role`,
      [username.trim(), email.toLowerCase().trim(), hashedPassword, whatsapp_phone?.trim() || null]
    );

    const user = result.rows[0];
    const token = signToken(user);

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        whatsapp_phone: user.whatsapp_phone,
        role: user.role,
      },
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ message: 'Username or email already exists' });
    }
    console.error('Register error:', err);
    res.status(500).json({ message: 'Server error during registration' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email?.trim() || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = signToken(user);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        whatsapp_phone: user.whatsapp_phone,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error during login' });
  }
});

module.exports = router;
