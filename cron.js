require('dotenv').config();
const cron = require('node-cron');
const { execSync } = require('child_process');

const REPO = '/home/kyosuke/pricelist';

const GIT_ENV = {
  ...process.env,
  GIT_SSH_COMMAND: 'ssh -i /home/kyosuke/.ssh/id_ed25519 -o StrictHostKeyChecking=no',
};

function gitPush(label) {
  try {
    const date = new Date().toISOString().slice(0, 10);
    execSync(`git -C ${REPO} add data.json`, { stdio: 'inherit', env: GIT_ENV });
    execSync(`git -C ${REPO} commit -m "Update price data ${date} [${label}]"`, { stdio: 'inherit', env: GIT_ENV });
    execSync(`git -C ${REPO} push origin main`, { stdio: 'inherit', env: GIT_ENV });
    console.log(`[${new Date().toISOString()}] GitHub Pages 更新完了`);
  } catch (e) {
    console.error(`git push エラー: ${e.message}`);
  }
}

console.log('cronジョブ開始 - 毎日自動実行');

// 深夜2時: シングルカード・PSA等
cron.schedule('0 2 * * *', async () => {
  console.log(`[${new Date().toISOString()}] scrape.js 開始`);
  try {
    execSync('node scrape.js', { stdio: 'inherit' });
    execSync('node translate.js', { stdio: 'inherit' });
    execSync('node save_history.js', { stdio: 'inherit' });
    console.log(`[${new Date().toISOString()}] scrape.js 完了`);
    gitPush('scrape');
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
    gitPush('snkrdunk');
  } catch (e) {
    console.error('エラー:', e.message);
  }
}, { timezone: 'Asia/Tokyo' });