/**
 * update_from_sheets.js
 * Google Spreadsheet（CSV公開）→ Claude で正規化 → data.json 更新
 *
 * 必要な環境変数：
 *   SHEETS_CSV_URL    : スプレッドシートのCSV公開URL
 *   ANTHROPIC_API_KEY : Anthropic APIキー
 */

const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

const SHEETS_CSV_URL  = process.env.SHEETS_CSV_URL;
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;

// ─── ラベルマッピング ────────────────────────────────────────
function getLabel({ game, category, shrink }) {
  if (game === 'yugioh') {
    if (category === 'BOX') return shrink === false ? '遊戯王 BOX シュリンクなし' : '遊戯王 BOX シュリンクあり';
    if (category === 'パック')  return '遊戯王 パック';
    if (category === 'デッキ')  return '遊戯王 デッキ';
    if (category === 'プロモ')  return '遊戯王 プロモ';
    return '遊戯王 その他';
  }
  if (game === 'op') {
    if (category === 'PSA') return 'OP PSA鑑定済';
    return 'ワンピース未開封BOX';
  }
  if (game === 'weiss') {
    if (category === 'BOX') return shrink === false ? 'ヴァイス BOX シュリンクなし' : 'ヴァイス BOX シュリンクあり';
    if (category === 'パック')  return 'ヴァイス パック';
    if (category === 'デッキ')  return 'ヴァイス デッキ';
    return 'ヴァイス その他';
  }
  // ポケモン（デフォルト）
  if (category === 'PSA')    return 'PSA鑑定済';
  if (category === 'BOX')    return shrink === false ? '未開封BOX シュリンクなし' : '未開封BOX シュリンクあり';
  if (category === 'パック')  return 'パック';
  if (category === 'デッキ')  return 'デッキ';
  if (category === 'プロモ')  return 'プロモ';
  return 'その他';
}

// ─── スプレッドシート取得 ────────────────────────────────────
async function fetchSheet() {
  console.log('Fetching sheet...');
  const res = await fetch(SHEETS_CSV_URL);
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);
  const csv = await res.text();

  // CSVの各行を取得（空行・ヘッダーを除外）
  const lines = csv
    .split('\n')
    .map(l => l.replace(/^"|"$/g, '').trim())  // CSVクォート除去
    .filter(l => l && !/^(商品|product|name|item)/i.test(l)); // ヘッダー除外

  console.log(`Sheet: ${lines.length} rows`);
  return lines;
}

// ─── Claude で正規化 ─────────────────────────────────────────
async function normalizeWithClaude(lines) {
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  const systemPrompt = `あなたはTCGカードショップの価格データ整理AIです。
スタッフが手入力したバラバラな商品名と価格を受け取り、以下を行ってください：

1. 【名寄せ】同じ商品の異なる表記を一つに統一
   例：「151BOX」「ポケモン151 BOX」「151 ボックス」→「ポケモン 151 BOX」

2. 【価格集約】同じ商品に複数の価格がある場合は中央値を採用

3. 【分類】ゲームとカテゴリを判定
   - game: "pokemon" | "yugioh" | "op" | "weiss"
   - category: "BOX" | "パック" | "デッキ" | "プロモ" | "PSA" | "その他"
   - shrink: BOXの場合のみ true（シュリンクあり）/ false（シュリンクなし）/ null（不明）

必ずJSON配列のみを返してください。説明文は不要です。`;

  const userPrompt = `以下の価格情報を整理してください：

${lines.join('\n')}

返却形式（JSONのみ）：
[
  {
    "name": "商品名（統一後）",
    "price": 数値,
    "game": "pokemon|yugioh|op|weiss",
    "category": "BOX|パック|デッキ|プロモ|PSA|その他",
    "shrink": true|false|null
  }
]`;

  console.log('Calling Claude API...');
  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].text.trim();
  console.log(`Claude response: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out tokens`);

  // JSONを抽出（コードブロックで囲まれていても対応）
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Claude returned non-JSON:\n' + text);

  return JSON.parse(jsonMatch[0]);
}

// ─── メイン ──────────────────────────────────────────────────
(async () => {
  if (!SHEETS_CSV_URL)  { console.log('No SHEETS_CSV_URL — skip'); process.exit(0); }
  if (!ANTHROPIC_KEY)   { console.log('No ANTHROPIC_API_KEY — skip'); process.exit(0); }

  // 1. スプレッドシート取得
  const lines = await fetchSheet();
  if (!lines.length) { console.log('Sheet is empty — skip'); process.exit(0); }

  // 2. Claude で正規化・名寄せ
  const normalized = await normalizeWithClaude(lines);
  console.log(`\n正規化結果: ${normalized.length} 商品`);

  // 3. ラベルごとに分類
  const byLabel = {};
  for (const item of normalized) {
    const label = getLabel(item);
    if (!byLabel[label]) byLabel[label] = [];
    byLabel[label].push({
      name:    item.name,
      nameEn:  item.name,
      price:   `¥${Number(item.price).toLocaleString()}`,
      img:     '',
      stock:   1,
      link:    '',
    });
    console.log(`  [${label}] ${item.name} → ¥${Number(item.price).toLocaleString()}`);
  }

  // 4. data.json に上書き保存
  const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));
  for (const [label, items] of Object.entries(byLabel)) {
    const idx = data.findIndex(d => d.label === label);
    if (idx >= 0) data[idx] = { label, items };
    else data.push({ label, items });
  }
  fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
  console.log('\ndata.json 更新完了！');
})();
