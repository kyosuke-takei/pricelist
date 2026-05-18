# pricelist / eBay 価格比較ツール — 作業進捗

## プロジェクト概要
- **場所**: `C:\Users\81908\Desktop\開発機能\pricelist\`
- **目的**: 当店（JP TCGショップ）の価格がeBayより安いアイテムを海外バイヤーに Discord で通知
- **対象カテゴリ**: ポケカPSA鑑定済 / OP PSA鑑定済 / ポケカ未開封BOX / ワンピース未開封BOX
- **メインファイル**: `scrape_ebay.js`（すべてのロジックここに集約）
- **GitHub**: https://github.com/kyosuke-takei/pricelist

## 現在の動作
```bash
node scrape_ebay.js --test       # 各カテゴリ2件のみ → テストch
node scrape_ebay.js --full-test  # 全件 → テストch
node scrape_ebay.js              # 全件 → 本番ch
```

GitHub Actions: 毎日 UTC 1:00（JST 10:00）自動実行（`.github/workflows/ebay_arbitrage.yml`）

## 実装済みフィルタリングロジック（scrape_ebay.js）

### 価格倍率（`getMultiplier`）
- ワンピースBOX: **1.20倍**
- PSA・ポケカBOX: **等倍（1.00）**
- `buyPrice = Math.round(parsePrice(item.price) * getMultiplier(cat.label))`

### PSAカード共通
- `titleMustInclude`: `['PSA', カード番号]`
- `titleMustExclude`: `['lot', 'bundle']`（ロット出品除外）

### OP PSA専用フィルタ
| 条件 | 処理 |
|------|------|
| 非パラレルカード | `mustExclude: 'parallel'` |
| CS/champ スタンプなし | `mustExclude: 'flagship', 'promo'` |
| パラレルカード `【XX/P】` | `mustInclude: 'parallel'` |
| 非SP カード | `mustExclude: 'SP', 'alt art', 'spc'` |
| OP05など本編セット | `mustExclude: 'EB01', 'EB02', 'EB03', 'PRB'`（クロスセットリプリント除外） |
| キャンペーン版でない | `mustExclude: 'campaign'` |
| 漫画絵なし | `mustExclude: 'manga', 'comic'` |
| 海賊旗なし | `mustExclude: 'pirate'` |

### OR条件フィルタ（`titleMustIncludeAnyOf`）
- 店舗カードに `漫画/コミック` → eBayに `manga` OR `comic` を要求
- 店舗カードに `海賊旗` → eBayに `pirate` を要求

### Discord Embed
- **thumbnail（右上小）**: 店舗の商品画像
- **image（下部大）**: eBayのヒット商品画像
- **Rarity Check フィールド**: レアリティ・Manga/Comic・Pirate Flag の双方向一致チェック（✅/⚠️）

## 未解決の課題
- **在庫データの鮮度問題**: data.json は lottery-monitor bot が定期更新するが、更新〜eBay比較実行の間に売切れたアイテムが通知に出ることがある。stock=1 で既に売れていても除外できない。

## 環境変数（`.env`）
```
EBAY_APP_ID=...
EBAY_CLIENT_SECRET=...
DISCORD_WEBHOOK_URL=...（本番）
DISCORD_TEST_WEBHOOK_URL=...（テスト）
```
GitHub Actions には `EBAY_APP_ID` と `EBAY_CLIENT_SECRET` を Secrets に追加済み（要確認）。

## 最終コミット
`d5e4d37` — "Improve eBay price comparison accuracy and filtering"（2026-05-17）
