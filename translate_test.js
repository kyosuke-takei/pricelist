require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

const API_KEY = process.env.POKEMON_TCG_API_KEY;

function parseCard(name) {
  const match = name.match(/\{(\d+\/\d+)\}/);
  const typeMatch = name.match(/【(\w+)】/);
  return {
    number: match ? match[1].split('/')[0] : null,
    total: match ? match[1].split('/')[1] : null,
    type: typeMatch ? typeMatch[1] : null,
  };
}

async function searchEnglishName(japName) {
  const { number, total } = parseCard(japName);
  if (!number || !total) return null;
  try {
    const res = await axios.get('https://api.pokemontcg.io/v2/cards', {
      headers: { 'X-Api-Key': API_KEY },
      params: { q: `number:${number}`, pageSize: 10 }
    });
    const match = res.data.data.find(c => c.set?.total == total);
    return match ? match.name : null;
  } catch (e) {
    return null;
  }
}

async function test() {
  const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));
  // 最初の10件だけテスト
  const samples = data[1].items.slice(0, 10);
  for (const item of samples) {
    const eng = await searchEnglishName(item.name);
    console.log(`${eng ? '✓' : '✗'} ${item.name} → ${eng || 'not found'}`);
    await new Promise(r => setTimeout(r, 300));
  }
}

test();