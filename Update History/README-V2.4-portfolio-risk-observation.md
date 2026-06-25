# V2.4 部位模擬與風險觀察

## 版本目標
- 從持股與交易績效，進一步加入整體部位配置觀察。
- 建立總資金、現金比例、單檔比例、產業比例與風險曝險管理。
- 依 BULL / RANGE / BEAR 市場模式調整部位風險判斷。

## 新增資料表
- portfolio_plans
- portfolio_plan_positions
- portfolio_risk_snapshots

## 新增 API
- GET /portfolio/summary
- GET /portfolio/plans
- POST /portfolio/plans
- PUT /portfolio/plans/:id
- DELETE /portfolio/plans/:id
- GET /portfolio/risk/latest
- GET /portfolio/risk/history
- POST /portfolio/risk/generate
- GET /v24/status
- GET /v24/acceptance

## 新增 scripts
- npm run portfolio:setup
- npm run portfolio:risk
- npm run portfolio:daily
- npm run v24:check
- npm run v24:test

## 前端
- 新增「部位模擬」頁。
- PWA 快取版本升級 stock-radar-pwa-v75。
- 系統狀態改讀 /v24/status。

## 驗收
- node --check server.js
- node --check stock-radar-frontend/app.js
- npm run v24:check
- npm run v24:test -- --api=http://localhost:3000
