# V1.2 第 6 項：ETF 資料修改說明

本次完成「ETF 資料也要進去」。

## 完成內容

1. 個股 / ETF 查詢
   - 原本「個股查詢」改成「個股 / ETF」。
   - 可輸入 0050、00878 這類 ETF 代號。

2. ETF 首次查詢自動建立基本資料
   - 若 stocks 表內沒有 ETF，後端會用 Yahoo Finance 即時資料建立基本資料。
   - ETF 會寫入 stocks：
     - stock_code：ETF 代號
     - stock_name：ETF 名稱
     - market_type：上市或上櫃
     - industry：ETF

3. ETF 即時行情
   - 支援現價、漲跌、漲跌幅、成交量、成交金額。
   - 主要先讀 TWSE MIS 即時資料。
   - 如果五檔或內外盤來源不足，ETF 會備援讀 Yahoo Finance chart。

4. ETF 自選股
   - ETF 可以加入自選股。
   - ETF 自選股會顯示 ETF 標籤。
   - 自選股頁讀取時，ETF 會即時補現價、成交量與漲跌幅。

5. ETF 明細頁
   - 看明細會顯示：
     - 盤中即時行情
     - ETF 資料區塊
     - 最新行情
   - ETF 不顯示公司每月營收、EPS、籌碼分數、大戶籌碼等不適用欄位。

## 新增 / 調整 API

- GET /stock/:stockCode/summary
  - ETF 若資料庫沒有，會自動讀即時資料並建立基本資料。

- GET /stock/:stockCode/realtime
  - ETF 支援即時行情。

- POST /watchlist
  - ETF 可以加入自選股。

- GET /watchlist
  - ETF 會即時補行情資料。

## 修改檔案

- stock-radar-api/server.js
- stock-radar-frontend/index.html
- stock-radar-frontend/app.js
- stock-radar-frontend/style.css
- stock-radar-frontend/service-worker.js

## 注意

1. 這次不用新增資料表。
2. 這次不需要手動跑 SQL。
3. ETF 首次查詢或首次加入自選時，API 主機需要可以連外讀 Yahoo / TWSE 即時資料。
4. ETF 的公司營收與 EPS 不適用，因此前端會自動隱藏。
5. PWA 快取版本已更新為 stock-radar-pwa-v20。
