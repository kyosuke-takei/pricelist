const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
puppeteer.use(StealthPlugin());

const BASE_URL = 'https://cardshop-shinsoku.jp/product-list/5/0/photo';

async function scrapeShinsoku() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');

  await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  const totalPages = await page.evaluate(() => {
    const links = document.querySelectorAll('.pager a');
    let max = 1;
    links.forEach(a => {
      const n = parseInt(a.innerText.trim());
      if (!isNaN(n) && n > max) max = n;
    });
    return max;
  });

  console.log(`総ページ数: ${totalPages}`);

  const allItems = [];
  let emptyCount = 0;
  const MAX_EMPTY = 3; // 3ページ連続0件で終了

  for (let p = 1; p <= totalPages; p++) {
    const url = p === 1 ? BASE_URL : `https://cardshop-shinsoku.jp/product-list/5/0/photo?page=${p}`;
    console.log(`ページ ${p}/${totalPages} 取得中...`);

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));

      const items = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('.list_item_photo').forEach(photoEl => {
          const dataEl = photoEl.nextElementSibling;
          if (!dataEl || !dataEl.classList.contains('list_item_data')) return;

          const img = photoEl.querySelector('img')?.src || photoEl.querySelector('[data-src]')?.getAttribute('data-src');
          const name = dataEl.querySelector('.goods_name')?.innerText?.trim();
          const modelNum = dataEl.querySelector('.model_number_value')?.innerText?.trim();
          const priceRaw = dataEl.querySelector('.figure')?.innerText?.trim();
          const price = priceRaw ? '¥' + priceRaw.replace(/[^\d,]/g, '') : null;
          const stockText = dataEl.querySelector('.stock')?.innerText?.trim();
          const stockMatch = stockText?.match(/\d+/);
          const stock = stockMatch ? parseInt(stockMatch[0]) : 0;

          if (name && price && stock > 0) {
            results.push({ name, modelNum, price, img, stock });
          }
        });
        return results;
      });

      allItems.push(...items);
      console.log(`  → ${items.length}件取得 (累計: ${allItems.length}件)`);

      if (items.length === 0) {
        emptyCount++;
        if (emptyCount >= MAX_EMPTY) {
          console.log(`${MAX_EMPTY}ページ連続0件のため終了`);
          break;
        }
      } else {
        emptyCount = 0;
      }
    } catch(e) {
      console.log(`  → ページ${p}エラー: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 1500));
  }

  await browser.close();
  console.log(`\n合計 ${allItems.length}件取得完了`);
  return { label: 'PSA鑑定済', items: allItems };
}

(async () => {
  const existing = JSON.parse(fs.readFileSync('data.json', 'utf8'));

  const result = await scrapeShinsoku();

  const idx = existing.findIndex(d => d.label === result.label);
  if (idx >= 0) existing[idx] = result;
  else existing.push(result);

  fs.writeFileSync('data.json', JSON.stringify(existing, null, 2));
  console.log('data.json に保存完了！');
})();
