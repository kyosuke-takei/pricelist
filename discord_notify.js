const fs = require('fs');

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

if (!WEBHOOK_URL) {
  console.log('No webhook URL found, skipping Discord notification');
  process.exit(0);
}

const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));

// 直近7日で価格が5%以上下がったカードを抽出
const deals = data
  .filter(item => item.change7d && item.change7d <= -5)
  .sort((a, b) => a.change7d - b.change7d)
  .slice(0, 5);

const fields = deals.map(item => ({
  name: item.nameEn || item.name,
  value: `¥${item.price.toLocaleString()} (${item.change7d}% 📉)`,
  inline: true
}));

const payload = {
  username: '🎴 Price Bot',
  embeds: [{
    title: '🔥 Today\'s Best Price Drops',
    description: 'These cards dropped in price — great time to buy!\n👉 [View Full List](https://kyosuke-takei.github.io/pricelist/)',
    color: 0xFF6B6B,
    fields: fields.length > 0 ? fields : [{
      name: 'No major drops today',
      value: 'Check the site for current prices!',
      inline: false
    }],
    footer: { text: 'Updated every 6 hours • JP Pokemon & One Piece Card Shop' },
    timestamp: new Date().toISOString()
  }]
};

fetch(WEBHOOK_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
})
.then(res => {
  if (res.ok) {
    console.log('✅ Discord notified!');
  } else {
    console.error('❌ Discord notification failed:', res.status);
  }
})
.catch(err => console.error('❌ Error:', err));
