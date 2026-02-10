const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const authMiddleware = require('../middleware/auth');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer setup (memory storage – no disk save)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Single image upload route (protected)
router.post('/image', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided' });
    }

    const result = await cloudinary.uploader.upload_stream(
      { folder: 'campus-connect' }, // optional folder in Cloudinary
      (error, result) => {
        if (error) throw error;
        res.json({ url: result.secure_url });
      }
    ).end(req.file.buffer);

  } catch (err) {
    console.error('Cloudinary upload error:', err);
    res.status(500).json({ message: 'Failed to upload image' });
  }
});

module.exports = router;