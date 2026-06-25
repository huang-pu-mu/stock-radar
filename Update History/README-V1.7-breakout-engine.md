# V1.7 技術突破引擎

## 本版目標

- 新增 Breakout Score 突破強度分數。
- 偵測 20 日新高、60 日新高、爆量突破、均線多頭、箱型突破。
- 今日雷達整合技術突破欄位。
- 新增 V1.7 自動驗收與 log 輸出。

## 新增指令

- npm run breakout:setup
- npm run breakout:generate
- npm run breakout:daily
- npm run v17:check
- npm run v17:test -- --api=http://localhost:3000

## 新增 API

- GET /breakout/latest
- GET /breakout/top
- GET /v17/status
- GET /v17/acceptance

## 新增資料表

- technical_breakout_signals
- technical_breakout_summaries
