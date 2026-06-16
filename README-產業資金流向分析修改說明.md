# 第 8 項：產業資金流向分析修改說明

本次版本新增「產業資金流向分析」，並補上產業分類資料更新流程。

## 一、這次新增功能

| 項目 | 說明 |
|---|---|
| 產業分類補齊腳本 | 新增 `stock-radar-api/scripts/updateIndustries.js`，可更新 `stocks.industry` |
| 產業分類完成度 API | 新增 `GET /industries/status`，可檢查上市、上櫃還有幾檔未分類 |
| 產業資金流向 API | 新增 `GET /radar/industry-flow`，依產業彙總三大法人買賣超 |
| 前端新頁籤 | 新增「產業資金」頁面 |
| 產業卡片 | 顯示法人合計、外資、投信、自營商、買超家數、上漲下跌家數、成交金額 |
| 產業內買超個股 | 每個產業顯示法人買超前 3 檔，可直接點進股票明細 |
| PWA 快取更新 | `service-worker.js` 版本更新為 `stock-radar-pwa-v12` |

## 二、新增後端 API

### 1. 產業分類完成度

```text
GET /industries/status
```

測試：

```text
http://localhost:3000/industries/status
```

回傳重點：

| 欄位 | 說明 |
|---|---|
| market_type | 上市 / 上櫃 |
| total_count | 股票總數 |
| classified_count | 已有產業分類數 |
| unclassified_count | 尚未分類數 |
| industry_count | 產業類別數 |
| classified_rate | 分類完成率 |

### 2. 產業資金流向

```text
GET /radar/industry-flow
```

測試：

```text
http://localhost:3000/radar/industry-flow
http://localhost:3000/radar/industry-flow?market=上市&limit=20
http://localhost:3000/radar/industry-flow?market=上櫃&limit=20
```

回傳重點：

| 欄位 | 說明 |
|---|---|
| industry | 產業名稱 |
| total_net_lots | 三大法人合計買賣超張數 |
| foreign_net_lots | 外資買賣超張數 |
| investment_trust_net_lots | 投信買賣超張數 |
| dealer_net_lots | 自營商買賣超張數 |
| stock_count | 該產業股票數 |
| net_buy_stock_count | 該產業法人買超股票數 |
| net_buy_ratio | 法人買超股票比例 |
| up_stock_count | 上漲家數 |
| down_stock_count | 下跌家數 |
| total_transaction_amount | 產業總成交金額 |
| avg_chip_score | 產業平均籌碼分數 |
| top_stocks | 該產業法人買超前 3 檔 |

## 三、新增指令

在 API 資料夾執行：

```powershell
cd D:\code\stock-radar\stock-radar-api
npm run industries
```

用途：

| 指令 | 作用 |
|---|---|
| `npm run industries` | 補齊 `stocks.industry` 產業分類 |
| `npm run daily -- 2026-06-16` | 每日流程會自動執行產業分類補齊 |

## 四、建議執行順序

第一次套用這版後，建議先手動跑一次產業分類：

```powershell
cd D:\code\stock-radar\stock-radar-api
npm run industries
```

再檢查分類完成度：

```text
http://localhost:3000/industries/status
```

如果 `unclassified_count` 接近 0，就可以測試產業資金流向：

```text
http://localhost:3000/radar/industry-flow
```

## 五、資料來源說明

| 市場 | 資料來源 |
|---|---|
| 上市 | TWSE 上市公司基本資料 OpenAPI / MOPS CSV 備援 |
| 上櫃 | TPEx 上櫃公司基本資料 OpenAPI / MOPS CSV 備援 |

## 六、這次修改檔案

| 檔案 | 修改內容 |
|---|---|
| `stock-radar-api/server.js` | 新增 `/industries/status`、`/radar/industry-flow` |
| `stock-radar-api/package.json` | 新增 `npm run industries` |
| `stock-radar-api/scripts/updateIndustries.js` | 新增產業分類補齊腳本 |
| `stock-radar-api/scripts/dailyTwse.js` | 每日流程加入補產業步驟 |
| `stock-radar-frontend/index.html` | 新增「產業資金」頁籤 |
| `stock-radar-frontend/app.js` | 新增產業資金流向頁面與卡片 |
| `stock-radar-frontend/style.css` | 新增產業資金卡片樣式，調整 9 個頁籤排版 |
| `stock-radar-frontend/service-worker.js` | PWA 快取版本更新 |

## 七、注意事項

| 狀況 | 說明 |
|---|---|
| 產業頁面沒有資料 | 請先確認 `institutional_trades` 有當日法人資料 |
| 很多股票顯示未分類 | 請先執行 `npm run industries` |
| 手機 PWA 沒看到新頁籤 | 請關掉 APP 重開，或瀏覽器強制重新整理 |
| 不需要新增資料表 | 本功能使用既有 `stocks`、`institutional_trades`、`daily_prices`、`chip_scores` |
| 不需要新增環境變數 | 本功能沒有新增 `.env` 設定 |
