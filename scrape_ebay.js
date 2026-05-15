const fs = require('fs');

const EBAY_APP_ID = process.env.EBAY_APP_ID;
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const PRICELIST_URL = 'https://kyosuke-takei.github.io/pricelist/';
const TEST_MODE = process.argv.includes('--test');

if (!EBAY_APP_ID) { console.log('No EBAY_APP_ID, skipping'); process.exit(0); }
if (!WEBHOOK_URL) { console.log('No DISCORD_WEBHOOK_URL, skipping'); process.exit(0); }
if (TEST_MODE) console.log('🧪 テストモード: 各カテゴリ最初の2件のみチェック');

const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));

// ── 為替レート取得 ────────────────────────────────
async function getUsdJpy() {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    const j = await res.json();
    return j.rates.JPY || 150;
  } catch { return 150; }
}

// ── 仕入れ価格パース ─────────────────────────────
function parsePrice(priceStr) {
  return parseInt((priceStr || '0').replace(/[^\d]/g, '')) || 0;
}

// ── サイト表示価格の倍率 ─────────────────────────
function getMultiplier(label) {
  if (label === 'ポケカ未開封BOX') return 0.97;
  if (label === 'ワンピース未開封BOX') return 1.20;
  return 1.05;
}

// ── eBay検索キーワード生成 ───────────────────────
function buildQuery(item, label) {
  const nameEn = item.nameEn || item.name || '';

  // BOX: styleCodeからセット型番だけ抽出 (OPC-TCG-OP-15 → OP-15, pkmn-tcg-M5 → M5)
  if (label.includes('BOX')) {
    const code = (item.styleCode || '')
      .replace(/^OPC-TCG-/, '')   // ワンピース: OPC-TCG-OP-15 → OP-15
      .replace(/^pkmn-tcg-/, ''); // ポケカ: pkmn-tcg-M5 → M5
    return code ? `${code} Japanese` : nameEn.split(' ').slice(0, 3).join(' ');
  }

  // PSA: グレード + カード番号のみ (PSA10 071/128)
  if (label.includes('PSA')) {
    const grade = nameEn.match(/PSA\s*(\d+)/i)?.[1];
    const num = nameEn.match(/(\d{3}\/[\w\-]+)/)?.[1];
    if (grade && num) return `PSA${grade} ${num} Japanese`;
    if (num) return `${num} PSA Japanese`;
    return nameEn.split(' ').slice(0, 3).join(' ');
  }

  // シングル: カード番号のみ (194/193)
  const num = nameEn.match(/\{([^}]+)\}/)?.[1];
  return num ? `${num} Japanese Pokemon` : nameEn.split(' ').slice(0, 2).join(' ');
}

// ── eBay落札済み検索 ─────────────────────────────
async function searchEbaySold(keyword) {
  const params = new URLSearchParams({
    'OPERATION-NAME': 'findCompletedItems',
    'SERVICE-VERSION': '1.0.0',
    'SECURITY-APPNAME': EBAY_APP_ID,
    'RESPONSE-DATA-FORMAT': 'JSON',
    'keywords': keyword,
    'itemFilter(0).name': 'SoldItemsOnly',
    'itemFilter(0).value': 'true',
    'paginationInput.entriesPerPage': '10',
    'sortOrder': 'EndTimeSoonest'
  });

  try {
    const res = await fetch(
      `https://svcs.ebay.com/services/search/FindingService/v1?${params}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const json = await res.json();
    if (TEST_MODE) {
      console.log(`  🌐 RAW:`, JSON.stringify(json).slice(0, 300));
    }
    const resp = json['findCompletedItemsResponse']?.[0];
    const items = resp?.searchResult?.[0]?.item;
    const total = parseInt(resp?.paginationOutput?.[0]?.totalEntries?.[0] || '0');

    if (!items || items.length === 0) return null;

    const prices = items
      .map(i => parseFloat(i.sellingStatus?.[0]?.currentPrice?.[0]?.['__value__'] || '0'))
      .filter(p => p > 0);

    if (prices.length === 0) return null;
    const avgUsd = prices.reduce((a, b) => a + b, 0) / prices.length;
    return { avgUsd, count: total, sampleSize: prices.length };
  } catch (e) {
    return null;
  }
}

// ── 待機 ─────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Discord通知 ──────────────────────────────────
async function sendToDiscord(opportunities, usdJpy) {
  if (opportunities.length === 0) {
    console.log('利益チャンスなし');
    return;
  }

  const CHUNK_SIZE = 10;
  const chunks = [];
  for (let i = 0; i < opportunities.length; i += CHUNK_SIZE) {
    chunks.push(opportunities.slice(i, i + CHUNK_SIZE));
  }

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const isFirst = ci === 0;

    const embeds = chunk.map(op => {
      const searchQ = encodeURIComponent(op.item.nameEn || op.item.name);
      const url = `${PRICELIST_URL}?q=${searchQ}`;
      const ebayJpy = Math.round(op.ebayAvgJpy);
      const profitJpy = Math.round(op.profit);
      const profitRate = op.profitRate.toFixed(1);

      return {
        color: op.profitRate >= 50 ? 0xFF6B6B : op.profitRate >= 30 ? 0xFFAA00 : 0x00CC66,
        title: (op.item.nameEn || op.item.name).slice(0, 80),
        url,
        fields: [
          { name: '🛒 仕入れ値', value: `¥${op.buyPrice.toLocaleString()}`, inline: true },
          { name: '📦 eBay落札均', value: `¥${ebayJpy.toLocaleString()} ($${op.ebayResult.avgUsd.toFixed(2)})`, inline: true },
          { name: '💰 推定利益', value: `¥${profitJpy.toLocaleString()} (+${profitRate}%)`, inline: true },
          { name: 'カテゴリ', value: op.cat.label, inline: true },
          { name: '在庫', value: `${op.item.stock ?? '-'}`, inline: true },
          { name: 'eBay実績数', value: `${op.ebayResult.count}件`, inline: true }
        ]
      };
    });

    if (isFirst) {
      embeds.unshift({
        title: `🔍 eBay価格差アービトラージ - Top ${opportunities.length}件`,
        description: `仕入れてeBayで売ると利益が出る可能性があるアイテム\n1USD = ¥${usdJpy.toFixed(0)} | eBay手数料13%考慮済み`,
        color: 0x00BBFF,
        timestamp: new Date().toISOString()
      });
      if (embeds.length > 10) embeds.pop();
    }

    if (ci === chunks.length - 1) {
      embeds[embeds.length - 1].footer = { text: 'eBay Finding API · 推定利益 = 落札均価 - eBay手数料(13%) - 仕入れ値' };
    }

    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '📊 Arbitrage Bot', embeds })
    });

    if (ci < chunks.length - 1) await sleep(1000);
  }

  console.log(`Discord通知完了: ${opportunities.length}件`);
}

// ── メイン ───────────────────────────────────────
async function main() {
  console.log('eBayアービトラージ分析開始...');
  const usdJpy = await getUsdJpy();
  console.log(`為替レート: 1USD = ¥${usdJpy.toFixed(0)}`);

  const opportunities = [];
  let checked = 0;
  let skipped = 0;

  for (const cat of data) {
    const multiplier = getMultiplier(cat.label);
    const items = TEST_MODE ? cat.items.slice(0, 2) : cat.items; // テストモードは2件のみ
    for (const item of items) {
      const buyPrice = parsePrice(item.price);

      // 在庫なし・価格不明・安すぎはスキップ
      if ((item.stock !== undefined && item.stock === 0)) { skipped++; continue; }
      if (buyPrice < 300) { skipped++; continue; }

      const keyword = buildQuery(item, cat.label);
      const result = await searchEbaySold(keyword);
      checked++;

      if (TEST_MODE) {
        console.log(`  🔍 検索: "${keyword}"`);
        console.log(`  📊 結果: ${result ? `${result.count}件落札 / 平均$${result.avgUsd?.toFixed(2)} (¥${Math.round((result.avgUsd||0)*usdJpy)})` : 'マッチなし'}`);
      }

      if (result && result.count >= 2) {
        const ebayAvgJpy = result.avgUsd * usdJpy;
        const ebayFee = ebayAvgJpy * 0.13; // eBay手数料
        const profit = ebayAvgJpy - ebayFee - buyPrice;
        const profitRate = (profit / buyPrice) * 100;

        if (TEST_MODE) console.log(`  💰 利益: ¥${Math.round(profit)} (${profitRate.toFixed(1)}%)${profitRate >= 20 ? ' ✅' : ' ❌ (20%未満)'}`);

        if (profitRate >= 20) {
          opportunities.push({ item, cat, buyPrice, ebayAvgJpy, profit, profitRate, ebayResult: result });
          console.log(`✅ ${item.nameEn || item.name}: 仕入¥${buyPrice} → eBay¥${Math.round(ebayAvgJpy)} (+${profitRate.toFixed(0)}%)`);
        }
      }

      if (!TEST_MODE && checked % 50 === 0) console.log(`進捗: ${checked}件チェック済み...`);
      await sleep(250); // API制限対策
    }
  }

  console.log(`\n完了: ${checked}件チェック / ${skipped}件スキップ / ${opportunities.length}件の利益チャンス`);

  opportunities.sort((a, b) => b.profit - a.profit);
  await sendToDiscord(opportunities.slice(0, 20), usdJpy);
}

main().catch(console.error);
