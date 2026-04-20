require('dotenv').config();
const fs = require('fs');

const trainerMap = {
  'ヒビキの': "Ethan's ",
  'コトネの': "Lyra's ",
  'シルバーの': "Silver's ",
  'マツバの': "Morty's ",
  'ミカンの': "Jasmine's ",
  'アカネの': "Whitney's ",
  'ヤナギの': "Pryce's ",
  'チャンピオンの': "Champion's ",
  'ロケット団の': "Team Rocket's ",
  'サカキの': "Giovanni's ",
  'オーキドの': "Oak's ",
  'ワタルの': "Lance's ",
  'カスミの': "Misty's ",
  'タケシの': "Brock's ",
  'サトシの': "Ash's ",
  'ホップの': "Hop's ",
  'マリィの': "Marnie's ",
  'ビートの': "Bede's ",
  'ソニアの': "Sonia's ",
  'メガ': 'Mega ',
  'ナナミの手助け': "Nanu's Assistance",
  'チリ': 'Chili',
  'メイのはげまし': "May's Encouragement",
  'チェレン': 'Cheren',
  'モノマネむすめ': 'Copycat',
  'ヒカリ': 'Dawn',
  'アセロラ': 'Acerola',
  'ミツルの思いやり': "Wally's Consideration",
  'ツツジ': 'Roxanne',
  'サザレ': 'Ryo',
  'カスミ＆カンナ': 'Misty & Lorelei',
  'リーリエの決心': "Lillie's Determination",
  'ヒガナ': 'Zinnia',
  'カトレア': 'Caitlin',
  'リーリエ': 'Lillie',
  'ポンチョを着た': 'Poncho-wearing ',
  'ひかるMew': 'Shining Mew',
  '20thアニバーサリー': '20th Anniversary',
  'カウンターゲイン': 'Counter Gain',
  '力の砂時計': 'Strength Charm',
  '〔状態A-〕': '[Condition A-] ',
};

function translateCardName(japName, nameMap) {
  let result = japName;
  for (const [ja, en] of Object.entries(trainerMap)) {
    result = result.replaceAll(ja, en);
  }
  const sorted = Object.keys(nameMap).sort((a, b) => b.length - a.length);
  for (const ja of sorted) {
    if (result.includes(ja)) {
      result = result.replace(ja, nameMap[ja]);
      break;
    }
  }
  result = result.replace(/([a-zA-Z])ex\b/g, '$1 ex');
  return result;
}

const nameMap = JSON.parse(fs.readFileSync('pokemon_names.json'));
const data = JSON.parse(fs.readFileSync('data.json'));

let translated = 0;
let skipped = 0;

for (const category of data) {
  for (const item of category.items) {
    const en = translateCardName(item.name, nameMap);
    item.nameEn = en;
    if (en !== item.name) translated++;
    else skipped++;
  }
}

fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
console.log(`完了: ${translated}件翻訳 / ${skipped}件未変換`);