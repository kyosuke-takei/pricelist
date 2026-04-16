require('dotenv').config();
const cron = require('node-cron');
const { execSync } = require('child_process');

console.log('cronジョブ開始 - 毎日午前2時に実行');

cron.schedule('0 2 * * *', async () => {
  console.log(`[${new Date().toISOString()}] スクレイピング開始`);
  try {
    execSync('node scrape.js', { stdio: 'inherit' });
    execSync('node translate.js', { stdio: 'inherit' });
    execSync('node save_history.js', { stdio: 'inherit' });
    console.log(`[${new Date().toISOString()}] 完了`);
  } catch (e) {
    console.error('エラー:', e.message);
  }
}, {
  timezone: 'Asia/Tokyo'
});