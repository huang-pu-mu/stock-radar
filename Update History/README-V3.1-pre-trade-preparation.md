# V3.1 半自動交易前置準備

## 版本目標

- 在 V3.0 交易輔助之後，補上交易前檢查清單。
- 建立買進計畫、減碼檢查、風險檢查與觀察清單。
- 保存使用者人工確認與操作紀錄。
- 保留計畫與實際結果比對欄位。
- 不串券商、不自動下單，所有動作都需人工確認。

## 新增資料表

- pre_trade_plans
- pre_trade_check_items
- pre_trade_action_logs

## 新增 API

- GET /pre-trade/summary
- GET /pre-trade/checklists
- POST /pre-trade/generate
- GET /pre-trade/plans
- POST /pre-trade/plans
- PUT /pre-trade/plans/:id/confirm
- POST /pre-trade/plans/:id/logs
- GET /v31/status
- GET /v31/acceptance

## 新增 scripts

- npm run pre-trade:setup
- npm run pre-trade:generate
- npm run pre-trade:daily
- npm run v31:check
- npm run v31:test

## 前端

- 新增「交易前準備」頁。
- PWA 快取版本：stock-radar-pwa-v78。
- 前端顯示：V3.1 半自動交易前置準備。

## 安全邊界

- 不串券商。
- 不自動下單。
- 不產生可直接送出的下單 API。
- 只做交易前檢查、人工確認與紀錄保存。
