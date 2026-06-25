# V3.0 實戰交易輔助系統

## 版本定位

- 從每日作戰室升級為交易前輔助流程。
- 建立交易候選、風險檢查、模擬下單草稿與人工確認流程。
- 初版不串券商、不自動下單，只做決策輔助與紀錄。

## 新增資料表

- trading_assistant_accounts
- trading_plans
- trading_plan_orders
- trading_assistant_recommendations
- trading_assistant_reports

## 新增 API

- GET /trade-assist/summary
- GET /trade-assist/recommendations
- POST /trade-assist/generate
- GET /trade-assist/plans
- POST /trade-assist/plans
- PUT /trade-assist/plans/:id
- DELETE /trade-assist/plans/:id
- GET /v30/status
- GET /v30/acceptance

## 新增 scripts

- npm run trading-assist:setup
- npm run trading-assist:generate
- npm run trading-assist:daily
- npm run v30:check
- npm run v30:test

## 前端

- 新增「交易輔助」頁。
- 顯示 V3.0 實戰交易輔助系統。
- 顯示交易輔助摘要、買進候選、減碼檢查、風險檢查、人工確認提醒。
- PWA 快取版本升級為 stock-radar-pwa-v77。

## 安全邊界

- 不串券商。
- 不做自動下單。
- 所有交易計畫與模擬下單草稿都必須人工確認。
