const fs = require('fs');
const path = require('path');

function calcTrending() {
  const histDir = path.join(__dirname, 'history');
  const files = fs.readdirSync(histDir).sort();
  if (files.length < 2) return [];

  const snapshots = files.map(f => JSON.parse(fs.readFileSync(path.join(histDir, f))));
  const latest = snapshots[snapshots.length - 1];

  const scores = [];
  for (const [url, item] of Object.entries(latest)) {
    const prices = snapshots.map(s => s[url]?.price).filter(Boolean);
    if (prices.length < 2) continue;

    const first = prices[0];
    const last = prices[prices.length - 1];
    const changeRate = ((last - first) / first) * 100;
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const volatility = ((high - low) / low) * 100;

    let consecutive = 0;
    for (let i = prices.length - 1; i > 0; i--) {
      if (prices[i] > prices[i - 1]) consecutive++;
      else break;
    }

    const score = changeRate * 0.4 + volatility * 0.3 + consecutive * 10 * 0.3;
    if (score <= 5) continue;

    scores.push({
      url,
      name: item.nameEn || item.name,
      nameJp: item.name,
      img: item.img,
      price: last,
      oldPrice: first,
      changeRate: parseFloat(changeRate.toFixed(1)),
      volatility: parseFloat(volatility.toFixed(1)),
      consecutive,
      score: parseFloat(score.toFixed(1)),
      category: item.category
    });
  }

  return scores.sort((a, b) => b.score - a.score);
}

const trending = calcTrending();
fs.writeFileSync('trending_cache.json', JSON.stringify(trending, null, 2));
console.log(`注目カード ${trending.length}件を trending_cache.json に保存`);
trending.slice(0, 10).forEach((c, i) => {
  console.log(`${i + 1}位: ${c.name} スコア:${c.score} (+${c.changeRate}%)`);
});