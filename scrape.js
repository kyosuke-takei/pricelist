const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
puppeteer.use(StealthPlugin());

async function scrapeAllPages(startUrl, label) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');

  let allItems = [];
  let pageNum = 1;

  await page.goto(startUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  while (true) {
    console.log(`取得中: ${label} - ${pageNum}ページ目`);

    const { items, hasNext, totalPages, currentPage } = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('div.item_data').forEach(el => {
        const name = el.querySelector('span.goods_name')?.innerText?.trim();
        const price = el.querySelector('.sell_price, .item_price, .price')?.innerText?.trim();
        const img = el.querySelector('img')?.src;
        const link = el.querySelector('a.item_data_link')?.href;

        // 在庫数を取得
        const stockText = el.innerText.match(/在庫数\s*(\d+)\s*枚/);
        const stock = stockText ? parseInt(stockText[1]) : 1;

        if (name && price) results.push({ name, price, img, link, stock });
      });

      const hasNext = !!document.querySelector('a.to_next_page');
      const currentPage = parseInt(document.querySelector('.pager strong')?.innerText) || 1;
      const pageLinks = [...document.querySelectorAll('.pager a.pager_btn')];
      const totalPages = pageLinks.reduce((max, el) => {
        const n = parseInt(el.innerText);
        return n > max ? n : max;
      }, currentPage);

      return { items: results, hasNext, totalPages, currentPage };
    });

    allItems = allItems.concat(items);
    console.log(`  → ${items.length}件取得（累計: ${allItems.length}件）[${currentPage}/${totalPages}ページ]`);

    if (!hasNext) break;

    const nextPage = currentPage + 1;
    await Promise.all([
      page.click('a.to_next_page'),
      page.waitForFunction(
        (np) => location.href.includes(`page=${np}`),
        { timeout: 15000 },
        nextPage
      )
    ]);
    await new Promise(r => setTimeout(r, 2000));
    pageNum++;
  }

  await browser.close();
  console.log(`\n${label}: 合計 ${allItems.length}件\n`);
  return { label, items: allItems };
}

(async () => {
  const results = [];
  results.push(await scrapeAllPages(
    'https://www.cardrush-pokemon.jp/product-group/447/0/photo?num=100&img=160&available=1&sort=',
    'AR/CHR'
  ));
  results.push(await scrapeAllPages(
    'https://www.cardrush-pokemon.jp/product-group/22/0/photo?num=100&img=160&available=1&sort=',
    'SR/SSR/HR/UR/SAR/MUR/MA'
  ));
  fs.writeFileSync('data.json', JSON.stringify(results, null, 2));
  console.log('data.json に保存完了！');
})();