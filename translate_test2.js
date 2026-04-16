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
};

function translateCardName(japName, nameMap) {
  let result = japName;

  // トレーナー名・接頭辞を置換
  for (const [ja, en] of Object.entries(trainerMap)) {
    result = result.replaceAll(ja, en);
  }

  // ポケモン名を置換（長い名前優先）
  const sorted = Object.keys(nameMap).sort((a, b) => b.length - a.length);
  for (const ja of sorted) {
    if (result.includes(ja)) {
      result = result.replace(ja, nameMap[ja]);
      break;
    }
  }

  // exをスペース区切りに
  result = result.replace(/([a-zA-Z])ex\b/g, '$1 ex');

  return result;
}

const nameMap = JSON.parse(fs.readFileSync('pokemon_names.json'));
const data = JSON.parse(fs.readFileSync('data.json'));

const samples = [
  ...data[0].items.slice(0, 10),
  ...data[1].items.slice(0, 10),
];

samples.forEach(item => {
  const en = translateCardName(item.name, nameMap);
  const ok = en === item.name ? '✗' : '✓';
  console.log(`${ok} ${item.name}`);
  console.log(`   → ${en}\n`);
});