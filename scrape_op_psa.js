const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
puppeteer.use(StealthPlugin());

// カードラッシュOP 鑑定済カードページ
// https://www.cardrush-op.jp/product-group/37
const BASE_URL = 'https://www.cardrush-op.jp/product-group/37/0/photo?num=100&img=480&available=1&sort=';

async function scrapeOpPsa() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  let allItems = [];
  let pageNum = 1;
  let totalPages = 1;

  while (pageNum <= totalPages) {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');

    const url = pageNum === 1 ? BASE_URL : `${BASE_URL}&page=${pageNum}`;
    console.log(`取得中: OP PSA - ${pageNum}ページ目`);

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise(r => setTimeout(r, 3000));

      const { items, detectedTotal } = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('div.item_data').forEach(el => {
          const name = el.querySelector('span.goods_name')?.innerText?.trim();
          const price = el.querySelector('.sell_price, .item_price, .price')?.innerText?.trim();
          const img = el.querySelector('img')?.src;
          const link = el.querySelector('a.item_data_link')?.href;
          const stockText = el.innerText.match(/在庫数\s*(\d+)\s*枚/);
          const stock = stockText ? parseInt(stockText[1]) : 1;
          if (name && price) results.push({ name, price, img, link, stock });
        });

        const currentPage = parseInt(document.querySelector('.pager strong')?.innerText) || 1;
        const pageLinks = [...document.querySelectorAll('.pager a.pager_btn')];
        const detectedTotal = pageLinks.reduce((max, el) => {
          const n = parseInt(el.innerText);
          return n > max ? n : max;
        }, currentPage);

        return { items: results, detectedTotal };
      });

      if (pageNum === 1) {
        totalPages = detectedTotal;
        console.log(`総ページ数: ${totalPages}`);
      }

      allItems = allItems.concat(items);
      console.log(`  → ${items.length}件取得（累計: ${allItems.length}件）[${pageNum}/${totalPages}ページ]`);

    } catch (e) {
      console.log(`  → エラー: ${e.message} - スキップ`);
    }

    await page.close();
    pageNum++;
    if (pageNum <= totalPages) await new Promise(r => setTimeout(r, 2000));
  }

  await browser.close();
  console.log(`\nOP PSA: 合計 ${allItems.length}件\n`);
  return { label: 'OP PSA鑑定済', items: allItems };
}

(async () => {
  const existing = JSON.parse(fs.readFileSync('data.json', 'utf8'));
  const result = await scrapeOpPsa();

  const idx = existing.findIndex(d => d.label === result.label);
  if (idx >= 0) existing[idx] = result;
  else existing.push(result);

  fs.writeFileSync('data.json', JSON.stringify(existing, null, 2));
  console.log('data.json に保存完了！');
})();
