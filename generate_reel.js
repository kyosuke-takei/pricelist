const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
puppeteer.use(StealthPlugin());

async function generateReel(cards) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=ja']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 100, deviceScaleFactor: 1 });

  const html = generateHTML(cards.slice(0, 9));
  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // 画像が全部読み込まれるまで待つ
  await page.evaluate(() => {
    return Promise.all(
      Array.from(document.images).map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(resolve => {
          img.onload = resolve;
          img.onerror = resolve;
        });
      })
    );
  });
  await new Promise(r => setTimeout(r, 3000));

  const outputDir = path.join(__dirname, 'reel_output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
  const today = new Date().toISOString().split('T')[0];
  const outputPath = path.join(outputDir, `reel_${today}.png`);

  await page.screenshot({ path: outputPath, fullPage: true });
  await browser.close();
  console.log('Generated: ' + outputPath);
  return outputPath;
}

function generateHTML(cards) {
  const today = new Date().toLocaleDateString('ja-JP', { year:'numeric', month:'2-digit', day:'2-digit' });

  const rows = cards.map((c, i) => {
    const shortName = c.name.length > 16 ? c.name.substring(0, 16) + '...' : c.name;
    return `
    <div style="background:#111;border-radius:6px;overflow:hidden;position:relative;">
      <div style="padding:5px 8px 4px;display:flex;justify-content:space-between;align-items:center;background:#111;">
        <div style="font-size:13px;font-weight:900;color:#fff;background:rgba(0,0,0,0.5);padding:1px 6px;border-radius:4px;">#${c.rank}</div>
        <div style="font-size:16px;font-weight:900;color:#FF2244;">&#9650; ${c.rate}</div>
      </div>
      <div style="background:#000;width:100%;height:220px;display:flex;align-items:center;justify-content:center;">
        <img src="${c.img}" style="max-width:100%;max-height:220px;object-fit:contain;display:block;"/>
      </div>
      <div style="padding:6px 6px 8px;background:#111;text-align:center;">
        <div style="font-size:12px;font-weight:900;color:#FFD700;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${shortName}</div>
        <div style="font-size:15px;font-weight:900;color:#ffffff;margin-top:3px;">&#165;${c.price}</div>
      </div>
    </div>
  `;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;900&display=swap" rel="stylesheet">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#1a1a1a; font-family:'Noto Sans JP','Arial Black',Arial,sans-serif; width:1080px; }
</style>
</head>
<body>
  <div style="padding:30px 30px 20px;text-align:center;border-bottom:4px solid #C9A84C;">
    <div style="font-size:18px;color:#C9A84C;letter-spacing:6px;margin-bottom:6px;">JAPANESE POKEMON MARKET</div>
    <div style="font-size:48px;font-weight:900;color:#fff;letter-spacing:3px;line-height:1.1;">
      TOP 9<br><span style="color:#C9A84C;">RISING CARDS</span>
    </div>
    <div style="font-size:16px;color:#555;letter-spacing:5px;margin-top:8px;">7-DAY PRICE SURGE RANKING</div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:12px;">
    ${rows}
  </div>

  <div style="text-align:center;padding:12px;border-top:1px solid #333;">
    <div style="font-size:15px;color:#444;letter-spacing:3px;">@kyosuke_pokemon_tcg_store</div>
    <div style="font-size:11px;color:#333;margin-top:4px;letter-spacing:2px;">PRICES AS OF ${today} • JPY</div>
  </div>
</body>
</html>`;
}

async function main() {
  const risingFile = path.join(__dirname, 'rising_cache.json');
  if (!fs.existsSync(risingFile)) {
    console.log('Run first: node scrape_rising.js --json > rising_cache.json');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(risingFile, 'utf8'));
  console.log('Generating image for 12 cards...');
  await generateReel(data);
}

main().catch(console.error);