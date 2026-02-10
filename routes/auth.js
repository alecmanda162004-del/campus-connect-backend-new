const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../models/db');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-this'; // fallback only for dev

// Register
router.post('/register', async (req, res) => {
  const { username, email, password, whatsapp_phone } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ message: 'Username, email, and password are required' });
  }

  if (!email.includes('@') || password.length < 6) {
    return res.status(400).json({ message: 'Invalid email format or password too short (min 6 chars)' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash, whatsapp_phone) VALUES ($1, $2, $3, $4) RETURNING id, username, email, whatsapp_phone',
      [username, email, hashedPassword, whatsapp_phone || null]
    );

    // In the try block, after inserting the user
const user = result.rows[0];

const token = jwt.sign(
  { userId: user.id, role: user.role },  // ← add role here
  process.env.JWT_SECRET,
  { expiresIn: '7d' }
);

res.status(201).json({
  message: 'User registered successfully',
  token,
  user: { id: user.id, username: user.username, email: user.email, whatsapp_phone: user.whatsapp_phone, role: user.role }  // ← optional: return role too
});
  } catch (err) {
    if (err.code === '23505') { // unique violation (username or email exists)
      return res.status(400).json({ message: 'Username or email already exists' });
    }
    console.error('Register error:', err);
    res.status(500).json({ message: 'Server error during registration' });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // After password match
const token = jwt.sign(
  { userId: user.id, role: user.role },  // ← add role here
  process.env.JWT_SECRET,
  { expiresIn: '7d' }
);

res.json({
  message: 'Login successful',
  token,
  user: { id: user.id, username: user.username, email: user.email, whatsapp_phone: user.whatsapp_phone, role: user.role }  // ← return role
});
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error during login' });
  }
});

module.exports = router;