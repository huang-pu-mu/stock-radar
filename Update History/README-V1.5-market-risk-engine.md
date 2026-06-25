# 雷達之星 V1.5：市場風險引擎

## 版本

- API：stock-radar-api-v1.5.0
- PWA：stock-radar-pwa-v61
- 目標：加入台指期夜盤市場風險修正，讓今日雷達具備隔日風險降權能力。

## 新增資料表

- market_risk_snapshots
  - 儲存台指期每日 / 夜盤市場風險快照。
  - 主要欄位：trade_date、contract_code、session_type、last_price、change_point、change_percent、after_hours_volume、market_risk_score、market_risk_level、market_mode、night_signal。
- market_risk_adjusted_scores
  - 儲存個股原始收盤分數與夜盤修正後分數。
  - 主要欄位：trade_date、stock_code、close_score、adjusted_score、night_adjustment、risk_weight、market_risk_score、market_risk_level、market_mode、risk_summary。

## 新增 npm 指令

- npm run market-risk:setup
- npm run market-risk:import
- npm run market-risk:score
- npm run market-risk:daily
- npm run v15:check
- npm run v15:test

## 新增 API

- GET /market-risk/latest
- GET /market-risk/top
- GET /v15/status
- GET /v15/acceptance

## 已整合既有 API

- GET /radar/top
  - 若 market_risk_adjusted_scores 已存在，會帶出：
    - close_score
    - market_adjusted_score
    - night_adjusted_score
    - night_adjustment
    - market_risk_score
    - market_risk_level
    - market_mode
    - risk_weight
    - risk_summary
  - 排序改優先使用 adjusted_score，沒有資料時退回 chip_score。

## 前端調整

- 首頁今日雷達新增 V1.5 市場風險卡片。
- 股票卡片新增：
  - 收盤分數
  - 夜盤修正
  - Market Risk
  - 市場模式
- Service Worker 快取版本升級為 stock-radar-pwa-v61。

## 自動測試與 log

### 靜態驗收

```powershell
cd D:\code\stock-radar\stock-radar-api
npm run v15:check
```

### 完整驗收與輸出 log

```powershell
cd D:\code\stock-radar\stock-radar-api
npm run v15:test -- --api=http://localhost:3000
```

### 只做本機靜態檢查，不連 DB / API

```powershell
cd D:\code\stock-radar\stock-radar-api
npm run v15:test -- --skip-db --skip-api
```

## log 位置

- stock-radar-api/logs/v15-acceptance-YYYYMMDD-HHMMSS.log

## 驗收標準

- log 最後出現：結果：PASS
- /health 可讀取
- /v15/status 可讀取
- /v15/acceptance 可讀取
- /market-risk/latest 可讀取
- /market-risk/top 可讀取
- /radar/top 可讀取並包含夜盤修正欄位
