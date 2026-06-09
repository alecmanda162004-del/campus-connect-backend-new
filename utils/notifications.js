const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;

const send = async (to, subject, html) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log('[email disabled] would send:', subject, 'to', to);
    return;
  }
  try {
    await transporter.sendMail({
      from: `"Campus-Connect" <${process.env.EMAIL_USER}>`,
      to, subject, html,
    });
  } catch (err) {
    console.error('Email send error:', err.message);
  }
};

const notifyNewListing = (listing) =>
  send(
    ADMIN_EMAIL,
    `New listing pending: ${listing.title}`,
    `<h2>New listing submitted</h2>
     <p><strong>Title:</strong> ${listing.title}</p>
     <p><strong>Price:</strong> K${Number(listing.price).toLocaleString()}</p>
     <p><strong>Category:</strong> ${listing.category}</p>
     <p><a href="https://campus-connect-zm.com/admin">Review in Admin Dashboard →</a></p>`
  );

const notifyListingDecision = (email, listing, status) => {
  const approved = status === 'approved';
  return send(
    email,
    approved ? `Your listing "${listing.title}" is live!` : `Update on your listing "${listing.title}"`,
    approved
      ? `<h2>Your listing is approved!</h2>
         <p><strong>${listing.title}</strong> is now live on Campus-Connect.</p>
         <p><a href="https://campus-connect-zm.com/listings/${listing.id}">View your listing →</a></p>`
      : `<h2>Listing not approved</h2>
         <p>Your listing <strong>${listing.title}</strong> was not approved.</p>
         <p>Please review our guidelines and try again.</p>`
  );
};

const notifyNewRating = (email, listing, rating) =>
  send(
    email,
    `New ${rating}-star rating on "${listing.title}"`,
    `<h2>Someone rated your listing</h2>
     <p><strong>${listing.title}</strong> received a ${rating}-star rating.</p>
     <p><a href="https://campus-connect-zm.com/listings/${listing.id}">View your listing →</a></p>`
  );

module.exports = { notifyNewListing, notifyListingDecision, notifyNewRating };