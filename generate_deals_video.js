const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
puppeteer.use(StealthPlugin());

function getDeals() {
  const histDir = path.join(__dirname, 'history');
  const files = fs.readdirSync(histDir).sort();
  if (files.length < 2) return [];

  const latest = JSON.parse(fs.readFileSync(path.join(histDir, files[files.length - 1])));
  const oldest = JSON.parse(fs.readFileSync(path.join(histDir, files[0])));

  const deals = [];
  for (const [url, item] of Object.entries(latest)) {
    if (!oldest[url]) continue;
    const oldPrice = oldest[url].price;
    const newPrice = item.price;
    if (!oldPrice || !newPrice || newPrice >= oldPrice) continue;
    const drop = oldPrice - newPrice;
    const dropPct = ((drop / oldPrice) * 100).toFixed(1);
    if (parseFloat(dropPct) < 3) continue;
    deals.push({
      name: item.nameEn || item.name,
      img: item.img,
      oldPrice,
      newPrice,
      drop,
      dropPct,
      rank: 0
    });
  }

  return deals.sort((a, b) => b.drop - a.drop).slice(0, 9).map((d, i) => ({ ...d, rank: i + 1 }));
}

async function generateDealFrame(browser, card, index, outputDir) {
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
    <div style="font-size:30px;color:#60ff90;letter-spacing:4px;">PRICE DROP ALERT</div>
  </div>

  <div style="background:#111;border-radius:16px;overflow:hidden;width:700px;">
    <div style="padding:20px 30px;display:flex;justify-content:space-between;align-items:center;background:#111;">
      <div style="font-size:40px;font-weight:900;color:#fff;background:rgba(0,0,0,0.5);padding:6px 20px;border-radius:10px;">#${card.rank}</div>
      <div style="font-size:48px;font-weight:900;color:#60ff90;">▼ ${card.dropPct}%</div>
    </div>
    <div style="background:#000;width:100%;height:580px;display:flex;align-items:center;justify-content:center;">
      <img src="${card.img}" style="max-width:100%;max-height:580px;object-fit:contain;display:block;"/>
    </div>
    <div style="padding:24px;background:#111;text-align:center;">
      <div style="font-size:28px;font-weight:900;color:#FFD700;line-height:1.3;">${card.name}</div>
      <div style="margin-top:12px;">
        <span style="font-size:28px;color:#888;text-decoration:line-through;">¥${card.oldPrice.toLocaleString()}</span>
        <span style="font-size:20px;color:#60ff90;margin:0 10px;">→</span>
        <span style="font-size:40px;font-weight:900;color:#60ff90;">¥${card.newPrice.toLocaleString()}</span>
      </div>
      <div style="font-size:24px;color:#ff6060;margin-top:8px;">-¥${card.drop.toLocaleString()} OFF</div>
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

  const outputPath = path.join(outputDir, `deal_frame_${String(index).padStart(2,'0')}.png`);
  await page.screenshot({ path: outputPath });
  await page.close();
  console.log('Generated: ' + outputPath);
}

async function generateSummaryFrame(browser, cards, outputDir) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });

  const miniCards = cards.map(c => `
    <div style="background:#111;border-radius:6px;overflow:hidden;">
      <div style="padding:4px 6px;display:flex;justify-content:space-between;">
        <div style="font-size:11px;font-weight:900;color:#fff;">#${c.rank}</div>
        <div style="font-size:13px;font-weight:900;color:#60ff90;">▼ ${c.dropPct}%</div>
      </div>
      <div style="background:#000;width:100%;height:300px;display:flex;align-items:center;justify-content:center;">
        <img src="${c.img}" style="max-width:100%;max-height:300px;object-fit:contain;"/>
      </div>
      <div style="padding:6px;text-align:center;">
        <div style="font-size:11px;font-weight:900;color:#FFD700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.name.length > 14 ? c.name.substring(0,14)+'...' : c.name}</div>
        <div style="font-size:14px;font-weight:900;color:#60ff90;">¥${c.newPrice.toLocaleString()}</div>
        <div style="font-size:11px;color:#ff6060;">-¥${c.drop.toLocaleString()}</div>
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
  <div style="padding:40px 30px 24px;text-align:center;border-bottom:4px solid #60ff90;">
    <div style="font-size:20px;color:#C9A84C;letter-spacing:6px;margin-bottom:8px;">JAPANESE POKEMON MARKET</div>
    <div style="font-size:52px;font-weight:900;color:#fff;line-height:1.1;">TOP 9<br><span style="color:#60ff90;">PRICE DROPS</span></div>
    <div style="font-size:18px;color:#555;letter-spacing:5px;margin-top:10px;">BEST DEALS TODAY</div>
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

  const outputPath = path.join(outputDir, 'deal_frame_09.png');
  await page.screenshot({ path: outputPath });
  await page.close();
  console.log('Generated summary frame');
}

(async () => {
  const deals = getDeals();
  if (deals.length === 0) { console.log('No deals found'); process.exit(0); }
  console.log(`${deals.length}件の価格下落カードを発見`);

  const outputDir = path.join(__dirname, 'reel_output', 'frames');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=ja'] });

  for (let i = 0; i < deals.length; i++) {
    await generateDealFrame(browser, deals[i], i, outputDir);
  }
  await generateSummaryFrame(browser, deals, outputDir);
  await browser.close();

  const today = new Date().toISOString().split('T')[0];
  const videoPath = path.join(__dirname, 'reel_output', `deals_${today}.mp4`);
  const frameCount = deals.length;
  const inputs = Array.from({length: frameCount}, (_,i) => `-loop 1 -t 2.5 -i ${outputDir}/deal_frame_${String(i).padStart(2,'0')}.png`).join(' ');
  const concat = Array.from({length: frameCount+1}, (_,i) => `[${i}:v]`).join('') + `concat=n=${frameCount+1}:v=1:a=0`;

  const ffmpegCmd = `ffmpeg -y ${inputs} -loop 1 -t 5 -i ${outputDir}/deal_frame_09.png -filter_complex "${concat},scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x1a1a1a" -c:v libx264 -pix_fmt yuv420p -r 30 ${videoPath}`;

  execSync(ffmpegCmd);
  console.log('Video generated: ' + videoPath);
})().catch(console.error);