# 雷達之星 Stock Radar V1.6 全球市場風險引擎

## 版本

- API：stock-radar-api-v1.6.0
- PWA：stock-radar-pwa-v62

## 新增功能

1. 全球市場風險快照
   - S&P 500
   - NASDAQ
   - Dow Jones
   - 費城半導體 SOX
   - NVIDIA
   - AMD
   - Microsoft
   - Apple
   - VIX
   - DXY
   - US10Y

2. Global Risk Score
   - 分數範圍：0～100
   - 市場模式：BULL / RANGE / BEAR
   - 風險評級：積極 / 正常 / 保守 / 高風險

3. 隔日開低機率
   - 依全球風險分數、半導體壓力、科技股壓力估算

4. 個股全球風險修正分數
   - 保留收盤分數
   - 保留 V1.5 夜盤修正分數
   - 新增 V1.6 全球修正分數

5. 前端首頁
   - 新增 V1.6 全球市場風險卡片
   - 股票卡片新增 Global Risk、全球修正、隔日開低機率

## 新增資料表

- global_market_snapshots
- global_market_components
- global_risk_adjusted_scores

## 新增 API

- GET /global-risk/latest
- GET /global-risk/top
- GET /v16/status
- GET /v16/acceptance

## 新增 npm 指令

- npm run global-risk:setup
- npm run global-risk:import
- npm run global-risk:score
- npm run global-risk:daily
- npm run v16:check
- npm run v16:test

## 驗收流程

```powershell
cd D:\code\stock-radar\stock-radar-api
npm run v16:test -- --api=http://localhost:3000
```

log 會輸出到：

```text
D:\code\stock-radar\stock-radar-api\logs\v16-acceptance-YYYYMMDD-HHMMSS.log
```

## 備註

- 外部資料來源讀取失敗時，global-risk:import 會用中性值補齊，避免驗收與每日排程中斷。
- 這版先完成全球風險引擎第一版，後續可再強化即時盤中、盤前、期貨與匯率資料來源。
