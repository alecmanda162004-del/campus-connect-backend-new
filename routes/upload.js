const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const authMiddleware = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = multer.memoryStorage();

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
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

const uploadToCloudinary = (buffer, folder) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        transformation: [{ quality: 'auto:good' }, { fetch_format: 'auto' }],
      },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });

// POST /api/upload/image — single image
router.post('/image', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No image file provided' });

    const result = await uploadToCloudinary(req.file.buffer, 'campus-connect/listings');

    res.status(200).json({
      status: 'success',
      url: result.secure_url,
      public_id: result.public_id,
    });
  } catch (err) {
    console.error('Single upload error:', err);
    res.status(500).json({ message: 'Image upload failed' });
  }
});

// POST /api/upload/multiple — up to 8 images
router.post('/multiple', authMiddleware, upload.array('images', 8), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No images provided' });
    }

    const urls = await Promise.all(
      req.files.map((file) => uploadToCloudinary(file.buffer, 'campus-connect/listings').then((r) => r.secure_url))
    );

    res.status(200).json({
      status: 'success',
      message: `${urls.length} image${urls.length === 1 ? '' : 's'} uploaded`,
      urls,
    });
  } catch (err) {
    console.error('Multi-upload error:', err);
    res.status(500).json({ message: 'Failed to upload images' });
  }
});

// DELETE /api/upload/:public_id — FIX: admin only
router.delete('/:public_id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await cloudinary.uploader.destroy(req.params.public_id);
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
