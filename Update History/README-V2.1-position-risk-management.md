# 雷達之星 Stock Radar｜V2.1 持股與風控管理

## 版本

- API：stock-radar-api-v2.1.0
- PWA：stock-radar-pwa-v72
- 前端顯示：V2.1 持股與風控管理

## 本次新增

1. 資料庫
   - user_positions
   - user_position_snapshots
   - position_risk_alerts

2. API
   - GET /positions
   - POST /positions
   - PUT /positions/:id
   - DELETE /positions/:id
   - GET /positions/summary
   - GET /positions/:id
   - GET /positions/:id/risk
   - GET /positions/:id/history
   - POST /positions/snapshot/generate
   - GET /position-risk/latest
   - GET /position-risk/alerts
   - POST /position-risk/alerts/:id/read
   - GET /v21/status
   - GET /v21/acceptance

3. scripts
   - npm run position:setup
   - npm run position:snapshot
   - npm run position:alerts
   - npm run position:daily
   - npm run v21:check
   - npm run v21:test

4. 前端
   - 新增「持股風控」頁
   - 新增持股表單
   - 新增持股列表
   - 新增損益統計
   - 新增風控提醒
   - 新增 AI 建議動作

## 測試流程

```powershell
cd D:\code\stock-radar\stock-radar-api
npm install
npm run position:setup
npm run v21:test -- --api=http://localhost:3000
```

## 驗收判斷

- PASS：可直接下一步。
- WARN：先判斷是否擋版。
- FAIL：回傳 log 後補 Patch。

## 注意

- V2.1 初版只做手動持股管理。
- 不串券商。
- 不自動下單。
- 不重做 V1.4。
- 保留 V2.0 AI 多因子功能與 /radar/top 修正。
