// routes/upload.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const authMiddleware = require('../middleware/auth');

// ────────────────────────────────────────
// Cloudinary config (should be in a separate config file in prod)
// ────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer: memory storage (no disk write) – good choice for serverless/Render
const storage = multer.memoryStorage();

// File filter: only allow images
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max per image
});

// ────────────────────────────────────────
// POST /api/upload/image – Single image (used for team member photos)
// ────────────────────────────────────────
router.post('/image', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided' });
    }

    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'campus-connect/team', // better organization
          resource_type: 'image',
          transformation: [
            { quality: 'auto:good' },
            { fetch_format: 'auto' },
          ],
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );

      uploadStream.end(req.file.buffer);
    });

    res.status(200).json({
      status: 'success',
      url: result.secure_url,
      public_id: result.public_id, // useful if you ever need to delete
    });
  } catch (err) {
    console.error('Cloudinary single upload error:', err);
    res.status(500).json({
      message: 'Image upload failed',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
});

// ────────────────────────────────────────
// POST /api/upload/multiple – Multiple images (used for hero carousel)
// Max 8 images, matches frontend limit
// ────────────────────────────────────────
router.post('/multiple', authMiddleware, upload.array('images', 8), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No images provided' });
    }

    const uploadPromises = req.files.map((file) => {
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'campus-connect/hero',
            resource_type: 'image',
            transformation: [
              { quality: 'auto:good' },
              { fetch_format: 'auto' },
              { width: 1920, height: 1080, crop: 'fill' }, // optional: standardize size
            ],
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result.secure_url);
          }
        );

        uploadStream.end(file.buffer);
      });
    });

    const urls = await Promise.all(uploadPromises);

    res.status(200).json({
      status: 'success',
      message: `${urls.length} image${urls.length === 1 ? '' : 's'} uploaded successfully`,
      urls,
    });
  } catch (err) {
    console.error('Cloudinary multi-upload error:', err);
    res.status(500).json({
      message: 'Failed to upload images',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
});

// Optional: DELETE /api/upload/:public_id – Remove image from Cloudinary (admin only)
router.delete('/:public_id', authMiddleware, async (req, res) => {
  try {
    const { public_id } = req.params;

    const result = await cloudinary.uploader.destroy(public_id);

    if (result.result !== 'ok') {
      return res.status(404).json({ message: 'Image not found or already deleted' });
    }

    res.json({ message: 'Image deleted successfully' });
  } catch (err) {
    console.error('Cloudinary delete error:', err);
    res.status(500).json({ message: 'Failed to delete image' });
  }
});

module.exports = router;