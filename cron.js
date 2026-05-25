require('dotenv').config();
const cron = require('node-cron');
const { execSync } = require('child_process');

console.log('cronジョブ開始 - 毎日午前2時に実行');

// 深夜2時: シングルカード・PSA等
cron.schedule('0 2 * * *', async () => {
  console.log(`[${new Date().toISOString()}] scrape.js 開始`);
  try {
    execSync('node scrape.js', { stdio: 'inherit' });
    execSync('node translate.js', { stdio: 'inherit' });
    execSync('node save_history.js', { stdio: 'inherit' });
    console.log(`[${new Date().toISOString()}] scrape.js 完了`);
  } catch (e) {
    console.error('エラー:', e.message);
  }
}, { timezone: 'Asia/Tokyo' });

// 深夜3時: SNKRDUNK TCG（キャッシュで高速化済み）
cron.schedule('0 3 * * *', async () => {
  console.log(`[${new Date().toISOString()}] scrape_snkrdunk_tcg.js 開始`);
  try {
    execSync('node scrape_snkrdunk_tcg.js', { stdio: 'inherit' });
    console.log(`[${new Date().toISOString()}] scrape_snkrdunk_tcg.js 完了`);
  } catch (e) {
    console.error('エラー:', e.message);
  }
}, { timezone: 'Asia/Tokyo' });