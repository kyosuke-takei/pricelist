const fs = require('fs');
const path = require('path');

function saveHistory() {
  const today = new Date().toISOString().split('T')[0];
  const historyDir = path.join(__dirname, 'history');

  if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir);

  const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));
  const snapshot = {};

  for (const category of data) {
    for (const item of category.items) {
      const price = parseInt(item.price.replace(/[^\d]/g, ''));
      snapshot[item.link] = {
        name: item.name,
        nameEn: item.nameEn,
        price,
        img: item.img,
        category: category.label,
      };
    }
  }

  const historyFile = path.join(historyDir, `${today}.json`);
  fs.writeFileSync(historyFile, JSON.stringify(snapshot, null, 2));
  console.log(`保存完了: history/${today}.json (${Object.keys(snapshot).length}件)`);
}

saveHistory();