# 第 9 項：主力籌碼分析修改說明

## 本次完成

- 新增 TDCC 集保大戶籌碼資料匯入流程。
- 新增 `major_holder_stats` 資料表。
- 新增「主力籌碼分析」後端 API。
- 新增前端「主力籌碼」頁籤。
- 個股「看明細」新增主力 / 大戶籌碼區塊。
- 籌碼分數計算開始納入 `big_holder_score`。
- PWA 快取版本更新為 `stock-radar-pwa-v13`。

## 新增資料來源

使用 TDCC 集保戶股權分散表：

```text
https://opendata.tdcc.com.tw/getOD.ashx?id=1-5
```

這份資料是每週更新，不是每日即時資料。

## 新增資料表

```text
major_holder_stats
```

主要欄位：

| 欄位 | 說明 |
|---|---|
| `data_date` | 集保資料日期 |
| `stock_code` | 股票代號 |
| `total_holder_count` | 總股東人數 |
| `small_holder_ratio` | 50 張以下持股比例 |
| `large_holder_ratio` | 400 張以上大戶持股比例 |
| `thousand_lot_ratio` | 1000 張以上大戶持股比例 |
| `avg_large_holder_lots` | 400 張以上平均每戶張數 |

## 新增 npm 指令

### 1. 建立資料表

```powershell
cd D:\code\stock-radar\stock-radar-api
npm run major-holders:setup
```

### 2. 匯入 TDCC 集保大戶資料

```powershell
npm run major-holders:import
```

### 3. 重新計算籌碼分數

```powershell
npm run score -- 2026-06-16
```

## 新增 API

### 1. 大戶資料匯入狀態

```text
GET /major-holders/status
```

測試：

```text
http://localhost:3000/major-holders/status
```

### 2. 主力籌碼排行

```text
GET /radar/major-holder
```

測試：

```text
http://localhost:3000/radar/major-holder
http://localhost:3000/radar/major-holder?market=上市&limit=20
http://localhost:3000/radar/major-holder?market=上櫃&limit=20
```

### 3. 個股大戶歷史資料

```text
GET /major-holders/:stockCode
```

測試：

```text
http://localhost:3000/major-holders/2330
```

## 主力籌碼分數邏輯

| 條件 | 說明 |
|---|---|
| 大戶比重高 | 400 張以上持股比例高，加分 |
| 大戶比重增加 | 和上一週比，大戶比重上升，加分 |
| 大戶張數增加 | 400 張以上持股張數增加，加分 |
| 散戶比重下降 | 散戶減少、大戶增加時，加分 |
| 大戶人數增加 | 人數與比重同步增加時，加分 |

## 修改檔案

| 檔案 | 修改內容 |
|---|---|
| `stock-radar-api/package.json` | 新增大戶資料建立與匯入指令 |
| `stock-radar-api/sql/major-holder-stats.sql` | 新增大戶籌碼資料表 SQL |
| `stock-radar-api/scripts/setupMajorHolderStats.js` | 新增建表腳本 |
| `stock-radar-api/scripts/importMajorHolders.js` | 新增 TDCC 匯入腳本 |
| `stock-radar-api/scripts/calculateChipScores.js` | 籌碼分數納入大戶分數 |
| `stock-radar-api/scripts/dailyTwse.js` | 每日流程加入 TDCC 大戶資料匯入 |
| `stock-radar-api/server.js` | 新增主力籌碼 API |
| `stock-radar-frontend/index.html` | 新增「主力籌碼」頁籤 |
| `stock-radar-frontend/app.js` | 新增主力籌碼頁面與明細區塊 |
| `stock-radar-frontend/style.css` | 新增主力籌碼樣式 |
| `stock-radar-frontend/service-worker.js` | 快取版本更新 |

## 本機測試順序

```powershell
cd D:\code\stock-radar\stock-radar-api
node --check server.js
node --check scripts/importMajorHolders.js
node --check scripts/calculateChipScores.js
npm run major-holders:setup
npm run major-holders:import
npm run score -- 2026-06-16
npm run dev
```

然後測試：

```text
http://localhost:3000/major-holders/status
http://localhost:3000/radar/major-holder
http://localhost:3000/major-holders/2330
```
