const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

if (!WEBHOOK_URL) {
  console.log('No webhook URL, skipping');
  process.exit(0);
}

async function scrapeRising() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');
  await page.goto('https://pokeca-chart.com/all-card?mode=5', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  const items = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('.cp_card.hover_big').forEach((el, i) => {
      const allText = el.innerText ? el.innerText.trim() : '';
      const imgEl = el.querySelector('img');
      const img = imgEl ? (imgEl.dataset.src || imgEl.getAttribute('data-lazy-src') || imgEl.src) : null;
      const link = el.querySelector('a') ? el.querySelector('a').href : null;
      const priceMatch = allText.match(/直近価格[\s\S]*?：([\d,]+)円/);
      const changeMatch = allText.match(/価格変動[\s\S]*?：([+\-][\d,]+)円/);
      const rateMatch = allText.match(/騰落率[\s\S]*?：([+\-][\d.]+)%/);
      const rate = rateMatch ? parseFloat(rateMatch[1]) : 0;
      if (rate >= 5) {
        results.push({
          rank: i + 1,
          price: priceMatch ? priceMatch[1] : null,
          change: changeMatch ? changeMatch[1] : null,
          rate: rateMatch ? rateMatch[1] + '%' : null,
          img: img,
          link: link
        });
      }
    });
    return results;
  });

  console.log('5%以上: ' + items.length + '件');

  const detailed = [];
  for (const item of items) {
    try {
      await page.goto(item.link, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));
      // 詳細ページから大きい画像URLを取得
      const result = await page.evaluate(() => {
        const h1 = document.querySelector('h1');
        const name = h1 ? h1.innerText.trim() : '';
        const imgEl = document.querySelector('.photo img, .wp-post-image, article img');
        const img = imgEl ? (imgEl.dataset.src || imgEl.getAttribute('data-lazy-src') || imgEl.src) : null;
        return { name, img };
      });
      detailed.push(Object.assign({}, item, {
        name: result.name,
        img: result.img || item.img
      }));
      console.log(item.rank + '位: ' + result.name + ' ' + item.rate);
    } catch(e) {
      detailed.push(Object.assign({}, item, { name: 'Card #' + item.rank }));
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  await browser.close();
  return detailed;
}

async function sendToDiscord(data) {
  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    const isFirst = i === 0;

    const payload = {
      username: 'Price Rising Bot',
      embeds: [{
        title: isFirst ? 'TOP Rising Cards (7 days / +5% or more) - ' + data.length + ' cards' : null,
        description: isFirst
          ? 'Cards with biggest price increase this week!\nBuy here: https://kyosuke-takei.github.io/pricelist/'
          : null,
        color: 0x00FF88,
        author: { name: d.rank + '位: ' + d.name },
        image: d.img ? { url: d.img } : null,
        fields: [
          { name: 'Price', value: 'JPY ' + d.price, inline: true },
          { name: 'Change (7d)', value: d.change + ' (' + d.rate + ')', inline: true }
        ],
        footer: i === data.length - 1 ? { text: 'JP Pokemon & One Piece Card Shop' } : null,
        timestamp: isFirst ? new Date().toISOString() : null
      }]
    };

    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    await new Promise(r => setTimeout(r, 800));
  }
  console.log('Discord notified! Total: ' + data.length + ' cards');
}

scrapeRising().then(sendToDiscord).catch(console.error);