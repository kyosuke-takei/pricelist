#!/bin/bash
cd /home/kyosuke/pricelist

echo "=== 価格上昇データ取得中... ==="
node scrape_rising.js --json > rising_cache.json

echo "=== リール画像生成中... ==="
node generate_reel.js

echo "=== リール動画生成中... ==="
node generate_video.js

echo "=== 完了！ ==="
echo "画像: /home/kyosuke/pricelist/reel_output/"
explorer.exe $(wslpath -w /home/kyosuke/pricelist/reel_output/)