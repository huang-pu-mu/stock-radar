# V2.5 每日投資作戰室

## 版本目標
- 將每日需要看的市場狀態、全球風險、AI 觀察股、持股續抱、減碼檢查、風控提醒與 LINE 摘要整合到單一頁面。
- 讓雷達之星從部位風險觀察，進一步升級成每日決策頁。

## 新增資料表
- daily_war_room_reports
- daily_war_room_items

## 新增 API
- GET /war-room/latest
- GET /war-room/history
- POST /war-room/generate
- GET /v25/status
- GET /v25/acceptance

## 新增 npm scripts
- war-room:setup
- war-room:generate
- war-room:daily
- v25:check
- v25:test

## 前端
- 新增「每日作戰室」頁。
- 顯示市場模式、Market Risk、Global Risk、今日觀察股、持股續抱、減碼檢查、風控提醒、產業強弱與 LINE 作戰摘要。
- PWA 快取版本升級 stock-radar-pwa-v76。

## 驗收
- npm run war-room:setup
- npm run war-room:generate
- npm run v25:test -- --api=http://localhost:3000
