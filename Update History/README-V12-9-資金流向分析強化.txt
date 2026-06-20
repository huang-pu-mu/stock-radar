# Stock Radar V1.2-9 資金流向分析強化

## 本次完成

1. 新增後端市場資金流向 API

- GET /market/flow?market=上市&days=20
- GET /market/flow/summary?market=上市&days=20&industryLimit=10

資料來源使用既有 V1.2 官方資料表：

- market_daily_summaries
- institutional_amount_summaries
- institutional_trades
- daily_prices
- chip_scores

## API 內容

/market/flow 會回傳近 N 個交易日的市場資金流向：

- trade_date
- market_type
- market_index
- index_change
- total_trade_amount
- trade_volume
- foreign_net_amount
- investment_trust_net_amount
- dealer_net_amount
- total_net_amount
- institutional_net_ratio_percent
- market_amount_change_percent
- flow_direction
- flow_strength

/market/flow/summary 會回傳前端資金流向頁使用的總覽資料：

- latest_date
- latest_total
- latest_markets
- trend
- industry_top

## 前端完成

新增頁籤：

- 資金流向

同時讓下列既有頁籤改用新的資金流向資料：

- 大盤走勢
- 法人總覽

前端顯示內容：

- 三大法人淨買賣金額
- 市場成交金額
- 成交金額較前日變化
- 外資 / 投信 / 自營商淨額
- 法人淨額占成交金額比例
- 上市 / 上櫃分市場狀態
- 三大法人淨額趨勢圖
- 外資淨額趨勢圖
- 成交金額近 12 筆長條圖
- 熱門產業資金流向

## 覆蓋檔案

stock-radar-api/server.js
stock-radar-frontend/index.html
stock-radar-frontend/app.js
stock-radar-frontend/style.css
stock-radar-frontend/service-worker.js
README-V12-9-資金流向分析強化.txt

## 覆蓋後測試

API：

https://stock-radar-api-ten.vercel.app/health
https://stock-radar-api-ten.vercel.app/market/flow?days=20
https://stock-radar-api-ten.vercel.app/market/flow/summary?days=20
https://stock-radar-api-ten.vercel.app/market/flow/summary?market=上市&days=20
https://stock-radar-api-ten.vercel.app/market/flow/summary?market=上櫃&days=20

前端：

1. 打開雷達之星 PWA
2. 點「資金流向」
3. 檢查是否出現趨勢圖、上市 / 上櫃資金狀態、熱門產業資金流向
4. 切換「全部 / 上市 / 上櫃」
5. 檢查「大盤走勢」與「法人總覽」是否也能正常顯示

## 版本

API：stock-radar-api-v1.2.9
Service Worker：stock-radar-pwa-v27

## 注意

這版使用每日官方資料表，不是即時行情。
若資料不足，請先確認已執行：

npm run official:market:history -- 2026-01-01 2026-06-18
npm run official:institutional-amounts:history -- 2026-01-01 2026-06-18
npm run official:daily

