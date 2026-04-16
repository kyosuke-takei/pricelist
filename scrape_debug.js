const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');

  await page.goto('https://snkrdunk.com/articles/14006/', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  const items = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('table tbody tr').forEach(tr => {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 2) return;
      const link = tds[1].querySelector('a');
      const name = link?.innerText?.trim();
      const href = link?.href;
      if (name && href && !href.includes('#')) {
        results.push({ name, href: href.split('?')[0] });
      }
    });
    return results;
  });

  console.log(`${items.length}件取得`);
  items.slice(0, 5).forEach(i => console.log(`${i.name} | ${i.href}`));

  await browser.close();
})();