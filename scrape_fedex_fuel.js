// scrape_fedex_fuel.js
// FedExのサイトからPuppeteerで燃料サーチャージを直接取得する

const puppeteer = require('puppeteer');
const fs = require('fs');

async function main() {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log('Fetching FedEx fuel surcharge page...');
    await page.goto('https://www.fedex.com/ja-jp/shipping/surcharges.html', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // テーブルが読み込まれるまで待機
    await page.waitForSelector('td[data-label="surcharge"]', { timeout: 15000 });

    // 最新行（一番上）のサーチャージ率を取得
    const result = await page.evaluate(() => {
      const rows = document.querySelectorAll('tbody.cc-aem-c-table__tbody tr');
      if (!rows || rows.length === 0) return null;

      const firstRow = rows[0];
      const weekCell = firstRow.querySelector('td[data-label="week"]');
      const priceCell = firstRow.querySelector('td[data-label="week Price"]');
      const surchargeCell = firstRow.querySelector('td[data-label="surcharge"]');

      if (!surchargeCell) return null;

      const surchargeText = surchargeCell.textContent.trim(); // e.g. "45.50%"
      const weekText = weekCell ? weekCell.textContent.trim() : '';
      const priceText = priceCell ? priceCell.textContent.trim() : '';
      const rate = parseFloat(surchargeText.replace('%', ''));

      return { rate, surcharge_text: surchargeText, week: weekText, price: priceText };
    });

    if (!result || isNaN(result.rate)) {
      throw new Error('Failed to parse surcharge rate');
    }

    const output = {
      rate: result.rate,
      surcharge_text: result.surcharge_text,
      week: result.week,
      price_usd: result.price,
      fetched_at: new Date().toISOString(),
      source: 'FedEx Japan surcharges page'
    };

    fs.writeFileSync('fedex_fuel_cache.json', JSON.stringify(output, null, 2));
    console.log(`FedEx Fuel Surcharge: ${result.rate}% (week: ${result.week}, price: ${result.price})`);
    console.log('Saved to fedex_fuel_cache.json');

  } catch (err) {
    console.error('Error:', err.message);

    // エラー時は前回の値を維持、なければフォールバック
    if (!fs.existsSync('fedex_fuel_cache.json')) {
      const fallback = {
        rate: 45.5,
        surcharge_text: '45.50%',
        week: 'fallback',
        price_usd: null,
        fetched_at: new Date().toISOString(),
        source: 'fallback'
      };
      fs.writeFileSync('fedex_fuel_cache.json', JSON.stringify(fallback, null, 2));
      console.log('Saved fallback to fedex_fuel_cache.json');
    } else {
      console.log('Keeping existing fedex_fuel_cache.json');
    }
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

main();