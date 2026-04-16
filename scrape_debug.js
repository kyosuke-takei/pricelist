const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');

  await page.goto('https://www.cardrush-pokemon.jp/product-group/447/0/photo?num=100&img=160&available=1&sort=', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  const page1Count = await page.evaluate(() => document.querySelectorAll('div.item_data').length);
  console.log('1ページ目 item_data数:', page1Count);

  // クリックとURL変化を同時に待つ
  await Promise.all([
    page.click('a.to_next_page'),
    page.waitForFunction(
      'location.href.includes("page=2")',
      { timeout: 15000 }
    )
  ]);
  await new Promise(r => setTimeout(r, 3000));

  const page2 = await page.evaluate(() => ({
    count: document.querySelectorAll('div.item_data').length,
    url: location.href,
    firstItem: document.querySelectorAll('div.item_data')[0]?.querySelector('span.goods_name')?.innerText
  }));
  console.log('2ページ目結果:', page2);

  await new Promise(r => setTimeout(r, 5000));
  await browser.close();
})();