const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
puppeteer.use(StealthPlugin());

async function generateCardImage(browser, card, index, outputDir) {
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
  <div style="text-align:center;padding:40px 0 30px;">
    <div style="font-size:22px;color:#C9A84C;letter-spacing:6px;margin-bottom:10px;">JAPANESE POKEMON MARKET</div>
    <div style="font-size:30px;color:#666;letter-spacing:4px;">7-DAY PRICE SURGE RANKING</div>
  </div>

  <div style="background:#111;border-radius:16px;overflow:hidden;width:700px;">
    <div style="padding:20px 30px;display:flex;justify-content:space-between;align-items:center;background:#111;">
      <div style="font-size:40px;font-weight:900;color:#fff;background:rgba(0,0,0,0.5);padding:6px 20px;border-radius:10px;">#${card.rank}</div>
      <div style="font-size:48px;font-weight:900;color:#FF2244;">&#9650; ${card.rate}</div>
    </div>
    <div style="background:#000;width:100%;height:700px;display:flex;align-items:center;justify-content:center;">
      <img src="${card.img}" style="max-width:100%;max-height:700px;object-fit:contain;display:block;"/>
    </div>
    <div style="padding:24px;background:#111;text-align:center;">
      <div style="font-size:28px;font-weight:900;color:#FFD700;line-height:1.3;">${card.name}</div>
      <div style="font-size:36px;font-weight:900;color:#ffffff;margin-top:12px;">&#165;${card.price}</div>
    </div>
  </div>

  <div style="text-align:center;padding:40px 0 20px;">
    <div style="font-size:22px;color:#C9A84C;letter-spacing:3px;">${index + 1} / 9</div>
  </div>

  <div style="position:absolute;bottom:40px;text-align:center;">
    <div style="font-size:20px;color:#333;letter-spacing:3px;">@kyosuke_pokemon_tcg_store</div>
  </div>
</body>
</html>`;

  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => {
    return Promise.all(
      Array.from(document.images).map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });
      })
    );
  });
  await new Promise(r => setTimeout(r, 2000));

  const outputPath = path.join(outputDir, `frame_${String(index).padStart(2,'0')}.png`);
  await page.screenshot({ path: outputPath, fullPage: false });
  await page.close();
  console.log('Generated frame: ' + outputPath);
}

async function generateSummaryFrame(browser, cards, outputDir) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });

  const miniCards = cards.map(c => `
    <div style="background:#111;border-radius:6px;overflow:hidden;">
      <div style="padding:4px 6px;display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:11px;font-weight:900;color:#fff;background:rgba(0,0,0,0.5);padding:1px 5px;border-radius:3px;">#${c.rank}</div>
        <div style="font-size:13px;font-weight:900;color:#FF2244;">&#9650; ${c.rate}</div>
      </div>
      <div style="background:#000;width:100%;height:340px;display:flex;align-items:center;justify-content:center;">
        <img src="${c.img}" style="max-width:100%;max-height:340px;object-fit:contain;display:block;"/>
      </div>
      <div style="padding:6px;text-align:center;">
        <div style="font-size:12px;font-weight:900;color:#FFD700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.name.length > 14 ? c.name.substring(0,14)+'...' : c.name}</div>
        <div style="font-size:15px;font-weight:900;color:#fff;margin-top:2px;">&#165;${c.price}</div>
      </div>
    </div>
  `).join('');

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;900&display=swap" rel="stylesheet">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#1a1a1a; font-family:'Noto Sans JP','Arial Black',Arial,sans-serif; width:1080px; height:1920px; display:flex; flex-direction:column; }
</style>
</head>
<body>
  <div style="padding:40px 30px 24px;text-align:center;border-bottom:4px solid #C9A84C;">
    <div style="font-size:20px;color:#C9A84C;letter-spacing:6px;margin-bottom:8px;">JAPANESE POKEMON MARKET</div>
    <div style="font-size:52px;font-weight:900;color:#fff;letter-spacing:3px;line-height:1.1;">
      TOP 9<br><span style="color:#C9A84C;">RISING CARDS</span>
    </div>
    <div style="font-size:18px;color:#555;letter-spacing:5px;margin-top:10px;">7-DAY PRICE SURGE RANKING</div>
  </div>

  <div style="flex:1;display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:16px;">
    ${miniCards}
  </div>

  <div style="text-align:center;padding:20px;border-top:1px solid #333;">
    <div style="font-size:16px;color:#444;letter-spacing:2px;">@kyosuke_pokemon_tcg_store</div>
  </div>
</body>
</html>`;

  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => {
    return Promise.all(
      Array.from(document.images).map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });
      })
    );
  });
  await new Promise(r => setTimeout(r, 3000));

  const outputPath = path.join(outputDir, 'frame_09.png');
  await page.screenshot({ path: outputPath, fullPage: false });
  await page.close();
  console.log('Generated summary frame: ' + outputPath);
}

async function generateVideo() {
  const risingFile = path.join(__dirname, 'rising_cache.json');
  if (!fs.existsSync(risingFile)) {
    console.log('Run first: node scrape_rising.js --json > rising_cache.json');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(risingFile, 'utf8'));
  const cards = data.slice(0, 9);

  const outputDir = path.join(__dirname, 'reel_output', 'frames');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=ja']
  });

  for (let i = 0; i < cards.length; i++) {
    console.log('Generating card ' + (i+1) + '/' + cards.length);
    await generateCardImage(browser, cards[i], i, outputDir);
  }

  console.log('Generating summary frame...');
  await generateSummaryFrame(browser, cards, outputDir);
  await browser.close();

  const today = new Date().toISOString().split('T')[0];
  const videoPath = path.join(__dirname, 'reel_output', `video_${today}.mp4`);

  const ffmpegCmd = `ffmpeg -y \
    -loop 1 -t 2.5 -i ${outputDir}/frame_00.png \
    -loop 1 -t 2.5 -i ${outputDir}/frame_01.png \
    -loop 1 -t 2.5 -i ${outputDir}/frame_02.png \
    -loop 1 -t 2.5 -i ${outputDir}/frame_03.png \
    -loop 1 -t 2.5 -i ${outputDir}/frame_04.png \
    -loop 1 -t 2.5 -i ${outputDir}/frame_05.png \
    -loop 1 -t 2.5 -i ${outputDir}/frame_06.png \
    -loop 1 -t 2.5 -i ${outputDir}/frame_07.png \
    -loop 1 -t 2.5 -i ${outputDir}/frame_08.png \
    -loop 1 -t 5 -i ${outputDir}/frame_09.png \
    -filter_complex "[0:v][1:v][2:v][3:v][4:v][5:v][6:v][7:v][8:v][9:v]concat=n=10:v=1:a=0,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x1a1a1a" \
    -c:v libx264 -pix_fmt yuv420p -r 30 ${videoPath}`;

  console.log('Generating video...');
  execSync(ffmpegCmd);
  console.log('Video generated: ' + videoPath);
}

generateVideo().catch(console.error);