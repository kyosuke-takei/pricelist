const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
puppeteer.use(StealthPlugin());

const SEARCH_URLS = [
  'https://snkrdunk.com/search?keywords=%E3%83%88%E3%83%AC%E3%82%AB+%28%E3%83%9C%E3%83%83%E3%82%AF%E3%82%B9%E3%83%BB%E3%83%91%E3%83%83%E3%82%AF%29&searchCategoryIds=6%2F26&brandIds=pokemon',
  'https://snkrdunk.com/search?keywords=%E3%83%88%E3%83%AC%E3%82%AB+%28%E3%83%87%E3%83%83%E3%82%AD%29&searchCategoryIds=6%2F27&brandIds=pokemon',
  'https://snkrdunk.com/search?keywords=%E3%83%88%E3%83%AC%E3%82%AB+%28%E3%83%97%E3%83%AD%E3%83%A2%29&searchCategoryIds=6%2F28&brandIds=pokemon',
  'https://snkrdunk.com/search?keywords=%E3%83%9D%E3%82%B1%E3%83%A2%E3%83%B3&brandIds=pokemon',
];

const CACHE_FILE = 'snkrdunk_cache.json';

const LABEL_SHRINK_ON  = '未開封BOX シュリンクあり';
const LABEL_SHRINK_OFF = '未開封BOX シュリンクなし';
const LABEL_PACK       = 'パック';
const LABEL_DECK       = 'デッキ';
const LABEL_PROMO      = 'プロモ';
const LABEL_OTHER      = 'その他';

function classifyByName(name) {
  const n = name || '';
  const nl = n.toLowerCase();

  if (n.includes('プロモ') || nl.includes('promo') ||
      n.includes('販促') || n.includes('特典')) return LABEL_PROMO;

  if (n.includes('デッキ') || n.includes('Deck') || n.includes('構築済み') ||
      n.includes('スターターセット') || n.includes('ハーフデッキ')) return LABEL_DECK;

  // シュリンクを先にチェック
  if (n.includes('シュリンクなし') || n.includes('シュリンク無し') || n.includes('シュリンク無')) return LABEL_SHRINK_OFF;
  if (n.includes('シュリンクあり') || n.includes('シュリンク付き') || n.includes('シュリンク有')) return LABEL_SHRINK_ON;

  // BOX判定（大文字小文字問わず box / ボックス）→ デフォルトはシュリンクあり
  const isBox = nl.includes('box') || n.includes('ボックス');
  if (isBox) return LABEL_SHRINK_ON;

  // パック単品
  if (n.includes('パック') || nl.includes('pack')) return LABEL_PACK;

  return null;
}

function classifyByPage(name, pageText) {
  const fromName = classifyByName(name);
  if (fromName) return fromName;
  const t = pageText || '';
  if (t.includes('プロモ') || t.includes('Promo')) return LABEL_PROMO;
  if (t.includes('デッキ') || t.includes('構築済み')) return LABEL_DECK;
  if (t.includes('シュリンクあり') || t.includes('シュリンク付き')) return LABEL_SHRINK_ON;
  if (t.includes('シュリンクなし') || t.includes('シュリンク無し')) return LABEL_SHRINK_OFF;
  if (t.includes('パック') && !t.includes('未開封BOX')) return LABEL_PACK;
  return LABEL_OTHER;
}

(async () => {
  // ─── ラベルキャッシュ読み込み ───
  const labelCache = fs.existsSync(CACHE_FILE)
    ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
    : {};
  const cachedCount = Object.keys(labelCache).length;
  console.log(`ラベルキャッシュ読み込み: ${cachedCount}件\n`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
  );

  // ─── Step 1: 検索ページをページネーションしてURL収集 ───
  const productMap = new Map(); // url → { name, price, img }

  for (const baseSearchUrl of SEARCH_URLS) {
    let pageNum = 1;
    while (pageNum <= 30) {
      const url = `${baseSearchUrl}&page=${pageNum}`;
      console.log(`[検索ページ ${pageNum}] ${url}`);
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 40000 });
        await new Promise(r => setTimeout(r, 3500));

        const found = await page.evaluate(() => {
          const results = [];
          const selectors = ['a[href*="/apparels/"]', 'a[href*="/products/"]', 'a[href*="snkrdunk.com/"]'];
          const seen = new Set();
          for (const sel of selectors) {
            document.querySelectorAll(sel).forEach(a => {
              const href = a.href;
              if (!href || seen.has(href)) return;
              if (!/snkrdunk\.com\/(apparels|products|trading-cards)\/\d+/.test(href)) return;
              seen.add(href);
              const card = a.closest('[class*="card"], [class*="item"], [class*="product"], li, article') || a;
              const nameEl = card.querySelector('[class*="name"], [class*="title"], h2, h3, p');
              const priceEl = card.querySelector('[class*="price"], [class*="ask"]');
              const imgEl = card.querySelector('img');
              results.push({
                url: href.split('?')[0],
                name: nameEl?.innerText?.trim() || '',
                price: priceEl?.innerText?.trim() || '',
                img: imgEl?.src || '',
              });
            });
            if (results.length > 0) break;
          }
          return results;
        });

        if (found.length === 0) { console.log('  → 最終ページ'); break; }

        let newCount = 0;
        found.forEach(item => {
          if (!productMap.has(item.url)) { productMap.set(item.url, item); newCount++; }
        });
        console.log(`  → ${found.length}件 (新規: ${newCount}件, 累計: ${productMap.size}件)`);
        if (newCount === 0) { console.log('  → 新規なし'); break; }
        pageNum++;
      } catch (e) {
        console.log(`  → エラー: ${e.message}`); break;
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\n収集完了: ${productMap.size}件`);

  // ─── Step 2: 分類（キャッシュヒット → スキップ、新規 → 詳細ページ訪問） ───
  const categories = {
    [LABEL_SHRINK_ON]: [], [LABEL_SHRINK_OFF]: [],
    [LABEL_PACK]: [], [LABEL_DECK]: [], [LABEL_PROMO]: [], [LABEL_OTHER]: [],
  };

  const SKIP_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7日間スキップ

  function getCacheLabel(url) {
    const entry = labelCache[url];
    if (!entry) return null;
    // SKIPエントリ: { label:'SKIP', until: timestamp }
    if (typeof entry === 'object' && entry.label === 'SKIP') {
      return Date.now() < entry.until ? 'SKIP' : null; // 期限切れならnull→再訪問
    }
    return entry; // 通常ラベル文字列
  }

  let hitCount = 0, visitCount = 0, nameCount = 0, skipCount = 0;

  for (const [productUrl, cached] of productMap) {
    const hasPriceFromSearch = cached.price && /\d/.test(cached.price);
    const cachedLabel = getCacheLabel(productUrl);

    // ① 価格なしとしてキャッシュ済み → 7日間スキップ
    if (cachedLabel === 'SKIP') {
      skipCount++;
      process.stdout.write(`[SKIP] `);
      continue;
    }

    // ② キャッシュにラベルあり + 検索から価格取得済み → 詳細ページ不要
    if (cachedLabel && hasPriceFromSearch) {
      if (categories[cachedLabel]) {
        categories[cachedLabel].push({
          name: cached.name, nameEn: cached.name,
          price: cached.price, img: cached.img, stock: 1, link: productUrl,
        });
        hitCount++;
        process.stdout.write(`[HIT] `);
      }
      continue;
    }

    // ③ 検索結果に価格なし → 出品なし（在庫なし）→ 即SKIP
    if (!hasPriceFromSearch) {
      labelCache[productUrl] = { label: 'SKIP', until: Date.now() + SKIP_TTL_MS };
      skipCount++;
      process.stdout.write(`[SKIP] `);
      continue;
    }

    // ④ 名前から分類できる + 価格あり → 詳細ページ不要、キャッシュに保存
    const quickLabel = classifyByName(cached.name);
    if (quickLabel) {
      labelCache[productUrl] = quickLabel;
      categories[quickLabel].push({
        name: cached.name, nameEn: cached.name,
        price: cached.price, img: cached.img, stock: 1, link: productUrl,
      });
      nameCount++;
      process.stdout.write(`[NAME] `);
      continue;
    }

    // ⑤ 詳細ページを訪問して分類・キャッシュ保存
    console.log(`\n[VISIT] ${productUrl}`);
    try {
      await page.goto(productUrl, { waitUntil: 'networkidle2', timeout: 40000 });
      await new Promise(r => setTimeout(r, 2500));

      const detail = await page.evaluate(() => {
        const name = document.querySelector('h1')?.innerText?.trim() || '';
        const priceSelectors = ['[class*="lowest-price"]','[class*="ask-price"]','[class*="lowest_price"]','[class*="price"]'];
        let priceText = '';
        for (const sel of priceSelectors) {
          const el = document.querySelector(sel);
          if (el?.innerText?.trim()) { priceText = el.innerText.trim(); break; }
        }
        const img =
          document.querySelector('[class*="main-image"] img, [class*="product-image"] img, .product-img img')?.src ||
          document.querySelector('img[class*="product"]')?.src || '';
        const pageText = document.body?.innerText?.slice(0, 3000) || '';
        const stockMatch = pageText.match(/在庫[：:]\s*(\d+)/);
        return { name, price: priceText, img, pageText, stock: stockMatch ? parseInt(stockMatch[1]) : 1 };
      });

      if (!detail.price || !/\d/.test(detail.price)) {
        labelCache[productUrl] = { label: 'SKIP', until: Date.now() + SKIP_TTL_MS };
        console.log('  → 価格なし - スキップ');
        continue;
      }

      const label = classifyByPage(detail.name, detail.pageText);
      labelCache[productUrl] = label;
      categories[label].push({
        name: detail.name, nameEn: detail.name,
        price: detail.price, img: detail.img, stock: detail.stock, link: productUrl,
      });
      console.log(`  → [${label}] ${detail.name} | ${detail.price}`);
      visitCount++;
    } catch (e) {
      console.log(`  → エラー: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  await browser.close();

  console.log(`\n─── 結果 ───`);
  console.log(`キャッシュHIT: ${hitCount}件 | 名前分類: ${nameCount}件 | 詳細訪問: ${visitCount}件 | SKIPキャッシュ: ${skipCount}件`);

  // ─── Step 3: ラベルキャッシュ保存 ───
  fs.writeFileSync(CACHE_FILE, JSON.stringify(labelCache, null, 2));
  console.log(`ラベルキャッシュ保存: ${Object.keys(labelCache).length}件`);

  // ─── Step 4: data.json 保存 ───
  const existing = JSON.parse(fs.readFileSync('data.json', 'utf8'));
  for (const [label, items] of Object.entries(categories)) {
    console.log(`${label}: ${items.length}件`);
    const idx = existing.findIndex(d => d.label === label);
    if (idx >= 0) existing[idx] = { label, items };
    else existing.push({ label, items });
  }
  fs.writeFileSync('data.json', JSON.stringify(existing, null, 2));
  console.log('\ndata.json 保存完了！');
})();
