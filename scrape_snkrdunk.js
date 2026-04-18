const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
puppeteer.use(StealthPlugin());

async function scrapeSnkrdunk(articleUrl, label) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');

  await page.goto(articleUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  const links = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('table tbody tr').forEach(tr => {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 1) return;
      const link = tds[0].querySelector('a') || (tds[1] && tds[1].querySelector('a'));
      const name = link?.innerText?.trim();
      const href = link?.href;
      // snkrdunk.com/apparels のみ取得
      if (name && href && href.includes('snkrdunk.com/apparels')) {
        results.push({ name, baseUrl: href.split('?')[0] });
      }
    });
    return results;
  });

  console.log(`記事から${links.length}件のリンク取得`);

  const allItems = [];

  for (const item of links) {
    console.log(`取得中: ${item.name}`);
    try {
      await page.goto(item.baseUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));

      const detail = await page.evaluate(() => {
        const nameRaw = document.querySelector('h1')?.innerText?.trim() || '';

        let styleCode = '';
        document.querySelectorAll('.product-detail-info-table tr').forEach(tr => {
          const th = tr.querySelector('th')?.innerText?.trim();
          const td = tr.querySelector('td')?.innerText?.trim();
          if (th === 'スタイルコード' && td) styleCode = td;
        });

        const cleanCode = styleCode.replace(/^OPC-TCG-/, "").replace(/^OPC-/, "OP-");
        const nameEn = cleanCode ? `${cleanCode} ${nameRaw}` : nameRaw;

        const nameJp = document.querySelector('p.product-name-jp')?.innerText?.trim();
        const priceRaw = document.querySelector('span.product-lowest-price')?.innerText?.trim();
        const price = priceRaw ? priceRaw.replace('~', '').trim() : null;
        const img = document.querySelector('.product-image-area img, .product-img img')?.src;
        const stockText = document.querySelector('.product-stock-label')?.innerText?.trim();
        const stockMatch = stockText?.match(/\d+/);
        const stock = stockMatch ? parseInt(stockMatch[0]) : 99;

        return { nameEn, nameJp, price, img, stock, styleCode };
      });

      if (detail.price) {
        allItems.push({
          name: detail.nameEn,
          nameEn: detail.nameEn,
          nameJp: detail.nameJp,
          styleCode: detail.styleCode,
          price: detail.price,
          img: detail.img,
          stock: detail.stock,
          link: item.baseUrl
        });
        console.log(`  → ${detail.nameEn} : ${detail.price} 在庫:${detail.stock}`);
      } else {
        console.log(`  → 価格なし - スキップ`);
      }
    } catch(e) {
      console.log(`  → エラー: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  await browser.close();
  console.log(`\n${label}: 合計${allItems.length}件\n`);
  return { label, items: allItems };
}

(async () => {
  const existing = JSON.parse(fs.readFileSync('data.json', 'utf8'));

  const pokemon = await scrapeSnkrdunk(
    'https://snkrdunk.com/articles/15950/',
    'ポケカ未開封BOX'
  );

  const onepiece = await scrapeSnkrdunk(
    'https://snkrdunk.com/articles/14006/',
    'ワンピース未開封BOX'
  );

  for (const result of [pokemon, onepiece]) {
    const idx = existing.findIndex(d => d.label === result.label);
    if (idx >= 0) existing[idx] = result;
    else existing.push(result);
  }

  fs.writeFileSync('data.json', JSON.stringify(existing, null, 2));
  console.log('data.json に保存完了！');
})();
