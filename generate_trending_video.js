const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
puppeteer.use(StealthPlugin());

function getTrending(categories) {
  const file = path.join(__dirname, 'trending_cache.json');
  if (!fs.existsSync(file)) return [];
  const data = JSON.parse(fs.readFileSync(file));
  return data
    .filter(d => categories.includes(d.category))
    .slice(0, 9)
    .map((d, i) => ({ ...d, rank: i + 1 }));
}

async function generateTrendingFrame(browser, card, index, outputDir, title) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;900&display=swap" rel="stylesheet">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#1a1a1a; font-family:'Noto Sans JP','Arial Black',Arial,sans-serif; width:1080px; height:1920px; display:flex; flex-direction:column; align-items:center; justify-content:center; }
</style>
</head>
<body>
  <div style="text-align:center;padding:15px 0 10px;">
    <div style="font-size:22px;color:#C9A84C;letter-spacing:6px;margin-bottom:10px;">JAPANESE POKEMON MARKET</div>
    <div style="font-size:28px;color:#ff9500;letter-spacing:4px;">🔥 ${title}</div>
  </div>

  <div style="background:#111;border-radius:16px;overflow:hidden;width:900px;">
    <div style="padding:20px 30px;display:flex;justify-content:space-between;align-items:center;background:#111;">
      <div style="font-size:40px;font-weight:900;color:#fff;background:rgba(0,0,0,0.5);padding:6px 20px;border-radius:10px;">#${card.rank}</div>
      <div style="font-size:36px;font-weight:900;color:#ff9500;">SCORE ${card.score}</div>
    </div>
    <div style="background:#000;width:100%;height:800px;display:flex;align-items:center;justify-content:center;">
      <img src="${card.img}" style="max-width:100%;max-height:800px;object-fit:contain;display:block;"/>
    </div>
    <div style="padding:24px;background:#111;text-align:center;">
      <div style="font-size:28px;font-weight:900;color:#FFD700;line-height:1.3;">${card.name}</div>
      <div style="margin-top:16px;text-align:center;">
        <div style="font-size:18px;color:#888;margin-bottom:8px;">Price Change</div>
        <div style="display:flex;align-items:center;justify-content:center;gap:16px;">
          <div style="font-size:32px;font-weight:900;color:#888;">¥${card.oldPrice.toLocaleString()}</div>
          <div style="font-size:28px;color:#FF2244;">→</div>
          <div style="font-size:40px;font-weight:900;color:#FF2244;">¥${card.price.toLocaleString()}</div>
        </div>
        <div style="font-size:24px;font-weight:900;color:#FF2244;margin-top:8px;">+${card.changeRate}%</div>
      </div>
    </div>
  </div>

  <div style="text-align:center;padding:15px 0 10px;">
    <div style="font-size:22px;color:#C9A84C;letter-spacing:3px;">${index + 1} / 9</div>
  </div>

  <div style="position:absolute;bottom:40px;text-align:center;">
    <div style="font-size:20px;color:#333;letter-spacing:3px;">@kyosuke_pokemon_tcg_store</div>
  </div>
</body>
</html>`;

  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => Promise.all(Array.from(document.images).map(img => {
    if (img.complete) return Promise.resolve();
    return new Promise(r => { img.onload = r; img.onerror = r; });
  })));
  await new Promise(r => setTimeout(r, 2000));

  const outputPath = path.join(outputDir, `trend_frame_${String(index).padStart(2,'0')}.png`);
  await page.screenshot({ path: outputPath });
  await page.close();
  console.log('Generated: ' + outputPath);
}

async function generateSummaryFrame(browser, cards, outputDir, title) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });

  const miniCards = cards.map(c => `
    <div style="background:#111;border-radius:6px;overflow:hidden;">
      <div style="padding:4px 6px;display:flex;justify-content:space-between;">
        <div style="font-size:11px;font-weight:900;color:#fff;">#${c.rank}</div>
        <div style="font-size:13px;font-weight:900;color:#ff9500;">🔥 ${c.score}</div>
      </div>
      <div style="background:#000;width:100%;height:300px;display:flex;align-items:center;justify-content:center;">
        <img src="${c.img}" style="max-width:100%;max-height:300px;object-fit:contain;"/>
      </div>
      <div style="padding:6px;text-align:center;">
        <div style="font-size:11px;font-weight:900;color:#FFD700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.name.length > 14 ? c.name.substring(0,14)+'...' : c.name}</div>
        <div style="font-size:14px;font-weight:900;color:#fff;">¥${c.price.toLocaleString()}</div>
        <div style="font-size:11px;color:#FF2244;">+${c.changeRate}%</div>
      </div>
    </div>
  `).join('');

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;900&display=swap" rel="stylesheet">
<style>* { margin:0; padding:0; box-sizing:border-box; } body { background:#1a1a1a; font-family:'Noto Sans JP',Arial,sans-serif; width:1080px; height:1920px; display:flex; flex-direction:column; }</style>
</head>
<body>
  <div style="padding:40px 30px 24px;text-align:center;border-bottom:4px solid #ff9500;">
    <div style="font-size:20px;color:#C9A84C;letter-spacing:6px;margin-bottom:8px;">JAPANESE POKEMON MARKET</div>
    <div style="font-size:48px;font-weight:900;color:#fff;line-height:1.1;">TOP 9<br><span style="color:#ff9500;">🔥 ${title}</span></div>
    <div style="font-size:18px;color:#555;letter-spacing:5px;margin-top:10px;">TRENDING NOW</div>
  </div>
  <div style="flex:1;display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:16px;">${miniCards}</div>
  <div style="text-align:center;padding:20px;border-top:1px solid #333;">
    <div style="font-size:16px;color:#444;letter-spacing:2px;">@kyosuke_pokemon_tcg_store</div>
  </div>
</body>
</html>`;

  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => Promise.all(Array.from(document.images).map(img => {
    if (img.complete) return Promise.resolve();
    return new Promise(r => { img.onload = r; img.onerror = r; });
  })));
  await new Promise(r => setTimeout(r, 3000));

  const outputPath = path.join(outputDir, 'trend_frame_09.png');
  await page.screenshot({ path: outputPath });
  await page.close();
  console.log('Generated summary frame');
}

(async () => {
  const configs = [
    { label: 'pokemon_sealed', title: 'POKEMON SEALED BOX', categories: ['ポケカ未開封BOX'] },
    { label: 'onepiece_sealed', title: 'ONE PIECE SEALED BOX', categories: ['ワンピース未開封BOX'] },
  ];

  const outputDir = path.join(__dirname, 'reel_output', 'frames');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=ja'] });

  for (const config of configs) {
    const cards = getTrending(config.categories);
    if (cards.length === 0) { console.log(`${config.label}: データなし`); continue; }
    console.log(`${config.label}: ${cards.length}件`);

    const configDir = path.join(__dirname, 'reel_output', 'frames', config.label);
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

    for (let i = 0; i < cards.length; i++) {
      await generateTrendingFrame(browser, cards[i], i, configDir, config.title);
    }
    await generateSummaryFrame(browser, cards, configDir, config.title);

    const today = new Date().toISOString().split('T')[0];
    const videoPath = path.join(__dirname, 'reel_output', `trending_${config.label}_${today}.mp4`);
    const frameCount = cards.length;
    const inputs = Array.from({length: frameCount}, (_,i) => `-loop 1 -t 2.5 -i ${configDir}/trend_frame_${String(i).padStart(2,'0')}.png`).join(' ');
    const concat = Array.from({length: frameCount+1}, (_,i) => `[${i}:v]`).join('') + `concat=n=${frameCount+1}:v=1:a=0`;
    const ffmpegCmd = `ffmpeg -y ${inputs} -loop 1 -t 5 -i ${configDir}/trend_frame_09.png -filter_complex "${concat},scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x1a1a1a" -c:v libx264 -pix_fmt yuv420p -r 30 ${videoPath}`;
    execSync(ffmpegCmd);
    console.log('✅ ' + videoPath);
  }

  await browser.close();
})().catch(console.error);