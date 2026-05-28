const fs = require('fs');

const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));

const GAME_LABELS = {
  pokemon: [
    'AR/CHR', 'SR/SSR/HR/UR/SAR/MUR/MA', 'ポケカ未開封BOX', 'PSA鑑定済',
    '未開封BOX シュリンクあり', '未開封BOX シュリンクなし', 'パック', 'デッキ', 'プロモ', 'その他',
  ],
  op: [
    'ワンピース未開封BOX', 'OP PSA鑑定済',
  ],
  yugioh: [
    '遊戯王 BOX シュリンクあり', '遊戯王 BOX シュリンクなし',
    '遊戯王 パック', '遊戯王 デッキ', '遊戯王 プロモ', '遊戯王 その他',
  ],
  weiss: [
    'ヴァイス BOX シュリンクあり', 'ヴァイス BOX シュリンクなし',
    'ヴァイス パック', 'ヴァイス デッキ', 'ヴァイス プロモ', 'ヴァイス その他',
  ],
};

for (const [game, labels] of Object.entries(GAME_LABELS)) {
  const gameData = data.filter(cat => labels.includes(cat.label));
  const json = JSON.stringify(gameData);
  fs.writeFileSync(`data_${game}.json`, json);
  const count = gameData.reduce((s, c) => s + (c.items?.length || 0), 0);
  console.log(`data_${game}.json: ${count} items, ${Math.round(json.length / 1024)}KB`);
}
console.log('Split complete!');
