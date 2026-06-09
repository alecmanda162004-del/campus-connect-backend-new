const https = require('https');

const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID   = process.env.TELEGRAM_CHANNEL_ID;
const SITE_URL     = 'https://campus-connect-zm.com';

const sendTelegramMessage = (text) => {
  if (!BOT_TOKEN || !CHANNEL_ID) {
    console.log('[telegram disabled] would send:', text.slice(0, 60));
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      chat_id:    CHANNEL_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    });

    const options = {
      hostname: 'api.telegram.org',
      path:     `/bot${BOT_TOKEN}/sendMessage`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    };

    const req = https.request(options, (res) => {
      res.on('data', () => {});
      res.on('end', resolve);
    });
    req.on('error', (err) => { console.error('Telegram error:', err.message); resolve(); });
    req.write(payload);
    req.end();
  });
};

const notifyNewListingTelegram = (listing) => {
  const emoji = {
    Food: '🍽️', Services: '⚙️', Electronics: '📱', Laptops: '💻',
    Scrubs: '🩺', Books: '📚', Accommodation: '🏠',
  };
  const icon = Object.entries(emoji).find(([k]) => listing.category?.includes(k))?.[1] || '🛍️';

  const text = [
    `${icon} <b>New listing on Campus-Connect!</b>`,
    ``,
    `<b>${listing.title}</b>`,
    `💰 <b>K${Number(listing.price).toLocaleString()}</b>`,
    `📂 ${listing.category || 'General'}`,
    ``,
    `<a href="${SITE_URL}/listings/${listing.id}">View listing →</a>`,
    `<a href="${SITE_URL}/marketplace">Browse all listings →</a>`,
  ].join('\n');

  return sendTelegramMessage(text);
};

const notifyNewAuctionTelegram = (auction, listing) => {
  const text = [
    `🔨 <b>New Auction on Campus-Connect!</b>`,
    ``,
    `<b>${listing.title}</b>`,
    `💰 Starting bid: <b>K${Number(auction.start_price).toLocaleString()}</b>`,
    `⏱️ Ends: ${new Date(auction.ends_at).toLocaleString()}`,
    ``,
    `<a href="${SITE_URL}/auctions">View auction →</a>`,
  ].join('\n');

  return sendTelegramMessage(text);
};

module.exports = { notifyNewListingTelegram, notifyNewAuctionTelegram };
