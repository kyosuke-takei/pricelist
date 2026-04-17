const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

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
      const img = el.querySelector('img') ? el.querySelector('img').src : null;
      const link = el.querySelector('a') ? el.querySelector('a').href : null;
      const priceMatch = allText.match(/直近価格[\s\S]*?：([\d,]+)円/);
      const changeMatch = allText.match(/価格変動[\s\S]*?：([+\-][\d,]+)円/);
      const rateMatch = allText.match(/騰落率[\s\S]*?：([+\-][\d.]+%)/);
      results.push({
        rank: i + 1,
        price: priceMatch ? priceMatch[1] : null,
        change: changeMatch ? changeMatch[1] : null,
        rate: rateMatch ? rateMatch[1] : null,
        img: img,
        link: link
      });
    });
    return results.slice(0, 10);
  });

  const detailed = [];
  for (const item of items) {
    try {
      await page.goto(item.link, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));
      const name = await page.evaluate(() => {
        const h1 = document.querySelector('h1');
        return h1 ? h1.innerText.trim() : '';
      });
      detailed.push(Object.assign({}, item, { name: name }));
      console.log(item.rank + '位: ' + name + ' ' + item.rate);
    } catch(e) {
      detailed.push(Object.assign({}, item, { name: 'Card #' + item.rank }));
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  await browser.close();
  return detailed;
}

scrapeRising().then(function(data) {
  console.log('\n=== TOP 10 RISING CARDS ===');
  data.forEach(function(d) {
    console.log(d.rank + '位: ' + d.name + ' | ' + d.price + '円 | ' + d.change + '円 | ' + d.rate);
  });
}).catch(console.error);