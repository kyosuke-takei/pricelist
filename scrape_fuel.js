const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
puppeteer.use(StealthPlugin());

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');
  await page.goto('https://mydhl.express.dhl/jp/ja/ship/surcharges.html', {
    waitUntil: 'networkidle2',
    timeout: 30000
  });
  await new Promise(r => setTimeout(r, 5000));

  const result = await page.evaluate(() => {
    const rows = document.querySelectorAll('table tr');
    for (const row of rows) {
      const text = row.innerText;
      if (text.includes('2026') && text.includes('%')) {
        const rateMatch = text.match(/([\d.]+)%/);
        const periodMatch = text.match(/2026.+/);
        if (rateMatch) {
          return {
            rate: parseFloat(rateMatch[1]),
            period: periodMatch ? periodMatch[0].trim() : '',
            updatedAt: new Date().toISOString()
          };
        }
      }
    }
    return null;
  });

  await browser.close();

  if (result) {
    fs.writeFileSync('fuel_cache.json', JSON.stringify(result, null, 2));
    console.log(`フューエルサーチャージ: ${result.rate}% (${result.period})`);
  } else {
    console.log('取得失敗');
  }
})();