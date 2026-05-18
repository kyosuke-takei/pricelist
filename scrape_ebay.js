const fs = require('fs');
const https = require('https');
const axios = require('axios');
require('dotenv').config();

const EBAY_CLIENT_ID = process.env.EBAY_APP_ID;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const PRICELIST_URL = 'https://kyosuke-takei.github.io/pricelist/';
const TEST_MODE = process.argv.includes('--test');
const FULL_TEST_MODE = process.argv.includes('--full-test'); // 全件 + テストch
const WEBHOOK_URL = (TEST_MODE || FULL_TEST_MODE)
  ? (process.env.DISCORD_TEST_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL)
  : process.env.DISCORD_WEBHOOK_URL;

if (!EBAY_CLIENT_ID) { console.log('No EBAY_APP_ID, skipping'); process.exit(0); }
if (!EBAY_CLIENT_SECRET) { console.log('No EBAY_CLIENT_SECRET, skipping'); process.exit(0); }
if (!WEBHOOK_URL) { console.log('No DISCORD_WEBHOOK_URL, skipping'); process.exit(0); }
if (TEST_MODE) console.log('🧪 テストモード: 各カテゴリ最初の2件のみチェック');
if (FULL_TEST_MODE) console.log('🔬 フルテストモード: 全件チェック → テストchに送信');

const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));

// SSL証明書検証を無効化（企業ネットワーク対応）
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ── OAuth アクセストークン取得 ────────────────────────
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;

  const credentials = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');
  const res = await axios.post(
    'https://api.ebay.com/identity/v1/oauth2/token',
    'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
    {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      httpsAgent
    }
  );

  cachedToken = res.data.access_token;
  tokenExpiry = Date.now() + (res.data.expires_in * 1000);
  console.log('✅ OAuth トークン取得成功');
  return cachedToken;
}

// ── 為替レート取得 ────────────────────────────────
async function getUsdJpy() {
  try {
    const res = await axios.get('https://open.er-api.com/v6/latest/USD', { httpsAgent });
    return res.data.rates.JPY || 150;
  } catch { return 150; }
}

// ── 仕入れ価格パース ─────────────────────────────
function parsePrice(priceStr) {
  return parseInt((priceStr || '0').replace(/[^\d]/g, '')) || 0;
}

// ── サイト表示価格の倍率 ─────────────────────────
function getMultiplier(label) {
  if (label === 'ワンピース未開封BOX') return 1.20;
  return 1.00;
}

// ── レアリティキーワード抽出 ─────────────────────
function extractRarityKeyword(nameEn, isOP) {
  if (isOP) {
    // OP形式: 【SR/P】【SP】【SEC/SP】【L/P】 など
    const r = (nameEn.match(/【([^】]+)】/)?.[1] || '').toUpperCase();
    if (r.includes('SP')) return 'SP';       // SP, SEC/SP
    if (r.includes('SEC')) return 'SEC';
    if (r.startsWith('L')) return 'L';       // L, L/P (Leader)
    const base = r.split('/')[0];            // SR, RRR, RR, R
    return /^[A-Z]+$/.test(base) ? base : null;
  } else {
    // ポケカ形式: 《AR》《SAR》《RR》《ACE》 など (特殊文字★や単文字Pなどは除外)
    const r = nameEn.match(/《([^》]+)》/)?.[1] || '';
    return /^[A-Za-z]{2,}$/.test(r) ? r : null;
  }
}

// ── eBay検索キーワード生成 ───────────────────────
function buildQuery(item, label) {
  const nameEn = item.nameEn || item.name || '';

  if (label.includes('BOX')) {
    const styleCode = item.styleCode || '';
    const isStarter = styleCode.startsWith('OPC-TCG-ST-');
    const code = styleCode.replace(/^OPC-TCG-/, '').replace(/^pkmn-tcg-/, '');
    const suffix = isStarter ? 'Japanese starter deck' : 'Japanese booster box sealed';
    return code ? `${code} ${suffix}` : `${nameEn.split(' ').slice(0, 3).join(' ')} ${suffix}`;
  }

  if (label.includes('PSA')) {
    const grade = nameEn.match(/PSA\s*(\d+)/i)?.[1];
    const num = nameEn.match(/\{([^}]+)\}/)?.[1];
    const isOP = label.includes('OP');
    const suffix = isOP ? 'Japanese One Piece' : 'Japanese Pokemon';
    const rarity = extractRarityKeyword(nameEn, isOP);

    if (!isOP) {
      // ポケカ: カード名を含めてセット重複を防ぐ
      const cardName = nameEn
        .replace(/【[^】]*】/g, '')
        .replace(/《[^》]*》/g, '')
        .replace(/\{[^}]*\}/g, '')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\([^)]*\)/g, '')
        .trim()
        .split(/\s+/).slice(0, 2).join(' '); // 最初の2単語
      if (grade && num && cardName) return `PSA${grade} ${cardName} ${num} ${suffix}`;
      if (grade && num) return `PSA${grade} ${num} ${suffix}`;
      return null;
    }

    // OP PSA
    if (grade && num && rarity) return `PSA${grade} ${num} ${rarity} ${suffix}`;
    if (grade && num) return `PSA${grade} ${num} ${suffix}`;
    if (num) return `${num} PSA ${suffix}`;
    return null;
  }

  const num = nameEn.match(/\{([^}]+)\}/)?.[1];
  return num ? `${num} Japanese Pokemon` : nameEn.split(' ').slice(0, 2).join(' ');
}

// ── eBay Browse API 検索 ─────────────────────────
async function searchEbay(keyword, token, { titleMustInclude, titleMustExclude, titleMustIncludeAnyOf } = {}) {
  try {
    const res = await axios.get('https://api.ebay.com/buy/browse/v1/item_summary/search', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Content-Type': 'application/json'
      },
      params: {
        q: keyword,
        limit: 20,
        sort: 'price',
        filter: 'buyingOptions:{FIXED_PRICE}'
      },
      httpsAgent
    });

    if (TEST_MODE) {
      console.log(`  🌐 RAW:`, JSON.stringify(res.data).slice(0, 300));
    }

    let items = res.data.itemSummaries;
    if (!items || items.length === 0) return null;

    // タイトルに必須ワードが含まれる商品のみに絞る
    if (titleMustInclude) {
      const words = Array.isArray(titleMustInclude) ? titleMustInclude : [titleMustInclude];
      items = items.filter(i =>
        words.every(w => i.title?.toLowerCase().includes(w.toLowerCase()))
      );
    }

    // タイトルに除外ワードが含まれる商品を除く
    if (titleMustExclude) {
      const words = Array.isArray(titleMustExclude) ? titleMustExclude : [titleMustExclude];
      items = items.filter(i =>
        words.every(w => !i.title?.toLowerCase().includes(w.toLowerCase()))
      );
    }

    // OR条件: グループ内のいずれかが含まれる商品のみ残す
    if (titleMustIncludeAnyOf) {
      for (const group of titleMustIncludeAnyOf) {
        items = items.filter(i =>
          group.some(w => i.title?.toLowerCase().includes(w.toLowerCase()))
        );
      }
    }

    const sorted = items
      .map(i => {
        const itemPrice = parseFloat(i.price?.value || '0');
        const shipping = parseFloat(i.shippingOptions?.[0]?.shippingCost?.value || '0');
        const total = itemPrice + shipping;
        return { total, itemPrice, shipping, url: i.itemWebUrl, title: i.title, imgUrl: i.image?.imageUrl };
      })
      .filter(i => i.total > 0)
      .sort((a, b) => a.total - b.total);

    if (sorted.length === 0) return null;

    const cheapest = sorted[0];

    return {
      medianLowUsd: cheapest.total,
      minUsd: cheapest.total,
      ebayUrl: cheapest.url,
      ebayTitle: cheapest.title,
      ebayImgUrl: cheapest.imgUrl,
      shipping: cheapest.shipping,
      count: res.data.total || sorted.length,
      sampleSize: sorted.length
    };
  } catch (e) {
    if (TEST_MODE) console.log(`  ⚠️ API エラー: ${e.response?.status} ${e.response?.data?.errors?.[0]?.message || e.message}`);
    return null;
  }
}

// ── 表示用タイトル整形 ────────────────────────────
function buildDisplayTitle(name) {
  // 状態・グレード情報を抽出
  const condition = name.match(/[〔【\[]([^〕】\]]*(?:状態|PSA|CGC)[^〕】\]]*)[〕】\]]/)?.[1] || '';
  // カード名本体（日本語・英語どちらも対応）
  // 〔〕【】[]() などの括弧を除いた最初の意味ある塊
  const clean = name
    .replace(/〔[^〕]*〕/g, '')
    .replace(/【[^】]*】/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/《[^》]*》/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // カード番号 {XXX}
  const num = name.match(/\{([^}]+)\}/)?.[1] || '';
  const title = [clean, num ? `{${num}}` : ''].filter(Boolean).join(' ').slice(0, 60);
  return condition ? `${title}　※${condition}` : title;
}

// ── eBay 落札済み検索（Finding API findCompletedItems）
async function searchEbaySold(keyword, _token, { titleMustInclude } = {}) {
  try {
    const params = new URLSearchParams({
      'OPERATION-NAME': 'findCompletedItems',
      'SERVICE-VERSION': '1.0.0',
      'SECURITY-APPNAME': EBAY_CLIENT_ID,
      'RESPONSE-DATA-FORMAT': 'JSON',
      'keywords': keyword,
      'itemFilter(0).name': 'SoldItemsOnly',
      'itemFilter(0).value': 'true',
      'paginationInput.entriesPerPage': '20',
      'sortOrder': 'PricePlusShippingLowest'
    });

    const res = await axios.get(
      `https://svcs.ebay.com/services/search/FindingService/v1?${params}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, httpsAgent }
    );

    const resp = res.data['findCompletedItemsResponse']?.[0];
    let items = resp?.searchResult?.[0]?.item;
    const total = parseInt(resp?.paginationOutput?.[0]?.totalEntries?.[0] || '0');
    if (!items || items.length === 0) return null;

    if (titleMustInclude) {
      const words = Array.isArray(titleMustInclude) ? titleMustInclude : [titleMustInclude];
      items = items.filter(i => {
        const title = i.title?.[0] || '';
        return words.every(w => title.toLowerCase().includes(w.toLowerCase()));
      });
    }

    const prices = items
      .map(i => parseFloat(i.sellingStatus?.[0]?.currentPrice?.[0]?.['__value__'] || '0'))
      .filter(p => p > 0)
      .sort((a, b) => a - b);

    if (prices.length === 0) return null;

    const lower = prices.slice(0, Math.max(1, Math.ceil(prices.length / 2)));
    const mid = Math.floor(lower.length / 2);
    const medianSoldUsd = lower.length % 2 === 0
      ? (lower[mid - 1] + lower[mid]) / 2
      : lower[mid];

    return { medianSoldUsd, minSoldUsd: prices[0], count: total || prices.length };
  } catch (e) {
    if (TEST_MODE) console.log(`  ⚠️ 落札API: ${e.response?.status} ${e.response?.data?.errorMessage?.[0]?.error?.[0]?.message?.[0] || e.message}`);
    return null;
  }
}

// ── 待機 ─────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Discord通知 ──────────────────────────────────
const BATCH_SIZE = 20;                          // 1バッチあたりの件数
const BATCH_DELAY_MS = 30 * 60 * 1000;         // バッチ間の待機時間（30分）

async function sendToDiscord(opportunities, usdJpy) {
  if (opportunities.length === 0) {
    console.log('No deals found');
    return;
  }

  // バッチ分割
  const batches = [];
  for (let i = 0; i < opportunities.length; i += BATCH_SIZE) {
    batches.push(opportunities.slice(i, i + BATCH_SIZE));
  }
  console.log(`${opportunities.length}件を${batches.length}バッチに分割して送信`);

  const CHUNK_SIZE = 3;

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    const batchStart = bi * BATCH_SIZE + 1;
    const batchEnd = batchStart + batch.length - 1;
    console.log(`\nバッチ ${bi + 1}/${batches.length} (${batchStart}–${batchEnd}件目) 送信中...`);

    const chunks = [];
    for (let i = 0; i < batch.length; i += CHUNK_SIZE) {
      chunks.push(batch.slice(i, i + CHUNK_SIZE));
    }

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      const isFirstChunk = ci === 0;

      const embeds = chunk.map(op => {
        const searchQ = encodeURIComponent(op.item.nameEn || op.item.name);
        const url = `${PRICELIST_URL}?q=${searchQ}`;
        const ebayUsd = op.ebayResult.medianLowUsd.toFixed(2);
        const storeUsd = (op.storePrice / usdJpy).toFixed(2);
        const savingUsd = (op.saving / usdJpy).toFixed(2);
        const savingRate = op.savingRate.toFixed(1);
        const displayTitle = buildDisplayTitle(op.item.nameEn || op.item.name);
        const nameEn = op.item.nameEn || op.item.name || '';
        const isOP = op.cat.label.includes('OP');

        let rarityField = null;
        if (op.cat.label.includes('PSA')) {
          const storeRarity = isOP
            ? extractRarityKeyword(nameEn, true)
            : (nameEn.match(/《([^》]+)》/)?.[1] || '').replace(/[^\w\/]/g, '') || null;
          const ebayTitle = (op.ebayResult.ebayTitle || '').toLowerCase();
          const lines = [];

          if (storeRarity && storeRarity !== '-') {
            const matched = ebayTitle.includes(storeRarity.toLowerCase());
            lines.push(`${matched ? '✅' : '⚠️'} ${storeRarity}${matched ? '' : ' — verify'}`);
          }

          if (isOP) {
            const hasMangaInStore = /漫画|コミック/i.test(nameEn);
            const hasMangaInEbay = ebayTitle.includes('manga') || ebayTitle.includes('comic');
            if (hasMangaInStore && hasMangaInEbay) {
              lines.push('✅ Manga/Comic');
            } else if (hasMangaInStore && !hasMangaInEbay) {
              lines.push('⚠️ Manga — not in eBay title');
            } else if (!hasMangaInStore && hasMangaInEbay) {
              lines.push('⚠️ eBay has Manga — store does not');
            }

            const hasPirateFlagInStore = /海賊旗/i.test(nameEn);
            const hasPirateFlagInEbay = ebayTitle.includes('pirate');
            if (hasPirateFlagInStore && hasPirateFlagInEbay) {
              lines.push('✅ Pirate Flag');
            } else if (hasPirateFlagInStore && !hasPirateFlagInEbay) {
              lines.push('⚠️ Pirate Flag — not in eBay title');
            } else if (!hasPirateFlagInStore && hasPirateFlagInEbay) {
              lines.push('⚠️ eBay has Pirate Flag — store does not');
            }
          }

          if (lines.length > 0) {
            rarityField = { name: 'Rarity Check', value: lines.join('\n'), inline: true };
          }
        }

        return {
          color: op.savingRate >= 40 ? 0xFF6B6B : op.savingRate >= 25 ? 0xFFAA00 : 0x00CC66,
          title: displayTitle,
          url,
          thumbnail: op.item.img ? { url: op.item.img } : undefined,
          image: op.ebayResult.ebayImgUrl ? { url: op.ebayResult.ebayImgUrl } : undefined,
          fields: [
            { name: '🌍 eBay Cheapest (incl. shipping)', value: `[$${ebayUsd}](${op.ebayResult.ebayUrl})${op.ebayResult.shipping > 0 ? ` · shipping $${op.ebayResult.shipping.toFixed(2)}` : ' · Free shipping'}\n\`${(op.ebayResult.ebayTitle || '').slice(0, 80)}\``, inline: false },
            ...(op.soldResult ? [{ name: '✔️ eBay Sold History', value: `$${op.soldResult.medianSoldUsd.toFixed(2)} · ${op.soldResult.count} sold`, inline: false }] : []),
            { name: '🏪 Our Store Price', value: `[$${storeUsd}](${url})  (¥${op.storePrice.toLocaleString()})`, inline: false },
            { name: '💸 You Save vs eBay', value: `$${savingUsd}  (${savingRate}% cheaper)`, inline: false },
            { name: 'Category', value: op.cat.label, inline: true },
            { name: 'Stock', value: `${op.item.stock ?? '-'}`, inline: true },
            { name: 'eBay Listings', value: `${op.ebayResult.count}`, inline: true },
            ...(rarityField ? [rarityField] : [])
          ]
        };
      });

      if (isFirstChunk) {
        embeds.unshift({
          title: `🛍️ JP Deals — Batch ${bi + 1}/${batches.length}  (${batchStart}–${batchEnd} of ${opportunities.length})`,
          description: [
            `**What is this channel?**`,
            `This bot scans our JP store daily and compares prices against eBay listings. Items where our store is at least 15% cheaper than eBay are posted here — so you can buy directly from us and skip the eBay markup.`,
            ``,
            `**How to use**`,
            `• Click the deal title to search the item on our store`,
            `• Check the eBay link to confirm the listing`,
            `• Compare the store image (top-right thumbnail) vs the eBay image (large photo) to verify it's the same card`,
            `• The **Rarity Check** field flags potential variant mismatches (rarity, manga art, etc.)`,
            ``,
            `**Notes**`,
            `• ⚠️ Prices and stock are collected automatically — always verify before purchasing`,
            `• Savings % = (eBay cheapest BIN incl. shipping − Our price) ÷ eBay price`,
            `• 1 USD = ¥${usdJpy.toFixed(0)}  ·  Batch ${bi + 1}/${batches.length}  (deals ${batchStart}–${batchEnd} of ${opportunities.length})`,
          ].join('\n'),
          color: 0x00BBFF,
          timestamp: new Date().toISOString()
        });
        if (embeds.length > 10) embeds.pop();
      }

      if (ci === chunks.length - 1) {
        embeds[embeds.length - 1].footer = { text: 'eBay Browse API · Savings = (eBay median low price − Our price) ÷ eBay price' };
      }

      try {
        const res = await axios.post(WEBHOOK_URL, { username: 'eBay Market Research', embeds }, { httpsAgent });
        console.log(`  chunk ${ci + 1}/${chunks.length} sent (${res.status})`);
      } catch (e) {
        console.error(`  chunk ${ci + 1} FAILED: ${e.response?.status} ${JSON.stringify(e.response?.data)}`);
      }

      if (ci < chunks.length - 1) await sleep(1500);
    }

    // 次のバッチまで待機（最後のバッチ以外）
    if (bi < batches.length - 1) {
      const delayMin = BATCH_DELAY_MS / 60000;
      console.log(`  次のバッチまで ${delayMin}分待機...`);
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log(`Discord notification sent: ${opportunities.length} deals`);
}

// ── メイン ───────────────────────────────────────
async function main() {
  console.log('eBay価格比較分析開始（当店の方が安いアイテムを探す）...');

  const token = await getAccessToken();
  const usdJpy = await getUsdJpy();
  console.log(`為替レート: 1USD = ¥${usdJpy.toFixed(0)}`);

  const opportunities = [];
  let checked = 0;
  let skipped = 0;

  // PSA鑑定済と未開封BOXのみ対象
  const TARGET_CATS = ['PSA', 'BOX'];
  const targetData = data.filter(cat => TARGET_CATS.some(t => cat.label.includes(t)));
  console.log(`対象カテゴリ: ${targetData.map(c => c.label).join(' / ')}`);

  for (const cat of targetData) {
    const items = TEST_MODE ? cat.items.slice(0, 2) : cat.items;
    for (const item of items) {
      const buyPrice = Math.round(parsePrice(item.price) * getMultiplier(cat.label));

      if (item.stock !== undefined && item.stock === 0) { skipped++; continue; }
      if (buyPrice < 300) { skipped++; continue; }

      const keyword = buildQuery(item, cat.label);
      if (!keyword) { skipped++; continue; }
      const isPsa = cat.label.includes('PSA');
      const isOP = cat.label.includes('OP');
      let opts = {};
      if (isPsa) {
        const nameEn = item.nameEn || item.name || '';
        const fullRarity = isOP ? (nameEn.match(/【([^】]+)】/)?.[1] || '') : '';
        const rarityParts = fullRarity.toUpperCase().split('/');
        // /P 末尾 → パラレル版 (SP/SPCは対象外)
        const isParallel = isOP && rarityParts.length > 1 && rarityParts[rarityParts.length - 1] === 'P';
        const rarity = isOP ? extractRarityKeyword(nameEn, true) : null;
        const excludeSP = isOP && rarity && rarity !== 'SP';
        // CS\d で始まるパターンがあればチャンピオンシップスタンプ版
        const hasCSStamp = isOP && /cs\d/i.test(nameEn);
        const num = nameEn.match(/\{([^}]+)\}/)?.[1];

        const mustInclude = num ? ['PSA', num] : ['PSA'];
        if (isParallel) mustInclude.push('parallel');

        const mustExclude = [];
        // PSA全般: ロット出品を除外
        mustExclude.push('lot', 'bundle');
        if (excludeSP) mustExclude.push('SP', 'alt art', 'spc');
        // parallel/flagship/promo除外はOPカードのみ (Pokémonのプロモカードを誤除外しないよう)
        if (isOP) {
          if (!isParallel) mustExclude.push('parallel');
          if (!hasCSStamp) mustExclude.push('flagship', 'promo');
          // 異なるコレクションのリプリント除外 (例: OP05-060 の EB02 版を除く)
          if (num) {
            const setCode = num.match(/^([A-Z]+\d+)/)?.[1]; // 'OP05', 'EB01', etc.
            const crossSetCodes = ['EB01', 'EB02', 'EB03', 'PRB'];
            crossSetCodes.forEach(s => {
              if (setCode && !setCode.startsWith(s.replace(/\d+$/, '')) && !mustExclude.includes(s)) {
                mustExclude.push(s);
              }
            });
          }
          // キャンペーンパラレルは店舗カードがキャンペーン版でなければ除外
          const hasCampaign = /campaign|キャンペーン/i.test(nameEn);
          if (!hasCampaign) mustExclude.push('campaign');
          // 漫画絵/コミックパラレルは双方向チェック
          const hasManga = /漫画|コミック/i.test(nameEn);
          if (!hasManga) mustExclude.push('manga', 'comic');
          // 海賊旗背景パラレル: 双方向チェック
          const hasPirateFlag = /海賊旗/i.test(nameEn);
          if (!hasPirateFlag) mustExclude.push('pirate');
        }

        const mustIncludeAnyOf = [];
        if (isOP) {
          const nameEnLocal = item.nameEn || item.name || '';
          // 店舗が漫画絵 → eBayにも manga or comic が必要
          if (/漫画|コミック/i.test(nameEnLocal)) mustIncludeAnyOf.push(['manga', 'comic']);
          // 店舗が海賊旗 → eBayにも pirate が必要
          if (/海賊旗/i.test(nameEnLocal)) mustIncludeAnyOf.push(['pirate']);
        }

        opts = {
          titleMustInclude: mustInclude,
          ...(mustExclude.length > 0 ? { titleMustExclude: mustExclude } : {}),
          ...(mustIncludeAnyOf.length > 0 ? { titleMustIncludeAnyOf: mustIncludeAnyOf } : {})
        };
      }
      const [result, soldResult] = await Promise.all([
        searchEbay(keyword, token, opts),
        searchEbaySold(keyword, token, opts)
      ]);
      checked++;

      if (TEST_MODE) {
        console.log(`  🔍 検索: "${keyword}"`);
        console.log(`  📊 出品中: ${result ? `${result.count}件 / 最安値帯$${result.medianLowUsd?.toFixed(2)} (¥${Math.round((result.medianLowUsd||0)*usdJpy)})` : 'なし'}`);
        console.log(`  📊 落札済: ${soldResult ? `${soldResult.count}件 / 最安値帯$${soldResult.medianSoldUsd?.toFixed(2)} (¥${Math.round((soldResult.medianSoldUsd||0)*usdJpy)})` : 'なし'}`);
      }

      if (result && result.count >= 2) {
        const ebayJpy = result.medianLowUsd * usdJpy;
        // お客さん視点: eBayで買うより当店が何%安いか
        const saving = ebayJpy - buyPrice;
        const savingRate = (saving / ebayJpy) * 100;

        if (TEST_MODE) console.log(`  💡 お得度: eBay¥${Math.round(ebayJpy)} → 当店¥${buyPrice} (${savingRate.toFixed(1)}%安い)${savingRate >= 15 ? ' ✅' : ' ❌ (15%未満)'}`);

        if (savingRate >= 15) {
          opportunities.push({ item, cat, keyword, storePrice: buyPrice, ebayJpy, saving, savingRate, ebayResult: result, soldResult });
          console.log(`✅ ${item.nameEn || item.name}: eBay¥${Math.round(ebayJpy)} → 当店¥${buyPrice} (${savingRate.toFixed(0)}%お得)`);
          console.log(`   eBay商品: "${result.ebayTitle}"`);
        }
      }

      if (!TEST_MODE && checked % 50 === 0) console.log(`進捗: ${checked}件チェック済み...`);
      await sleep(200);
    }
  }

  console.log(`\n完了: ${checked}件チェック / ${skipped}件スキップ / ${opportunities.length}件のお得アイテム`);

  opportunities.sort((a, b) => b.savingRate - a.savingRate);
  await sendToDiscord(opportunities, usdJpy);
}

main().catch(console.error);
