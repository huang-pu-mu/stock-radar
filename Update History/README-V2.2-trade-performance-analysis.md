# V2.2 交易紀錄與績效分析

## 版本目標

- 從持股風控延伸到實際交易紀錄與績效追蹤。
- 支援手動新增買進 / 賣出紀錄。
- 產生已實現損益、勝率、平均獲利、平均虧損與策略來源績效。

## 新增資料表

- user_trades：使用者交易紀錄。
- user_realized_trades：賣出後的已實現損益紀錄。
- user_performance_snapshots：交易績效快照。

## 新增 API

- GET /trades
- POST /trades
- PUT /trades/:id
- DELETE /trades/:id
- GET /trades/summary
- POST /trades/performance/generate
- GET /performance/latest
- GET /performance/history
- GET /performance/strategy
- GET /v22/status
- GET /v22/acceptance

## 新增 npm scripts

- npm run trade:setup
- npm run trade:performance
- npm run trade:daily
- npm run v22:check
- npm run v22:test

## 前端

- 新增「交易績效」頁。
- 側邊選單版本文字升級為 V2.2 交易紀錄與績效分析。
- PWA 快取版本升級為 stock-radar-pwa-v73。

## 驗收

- node --check server.js
- node --check stock-radar-frontend/app.js
- npm run v22:check
- npm run v22:test -- --api=http://localhost:3000
