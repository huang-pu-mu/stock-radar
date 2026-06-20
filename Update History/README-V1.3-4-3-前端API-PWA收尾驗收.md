# V1.3-4-3：前端 / API / PWA 收尾驗收

## 一、本次目標

本次是 V1.3 正式定版前的收尾驗收補強，目標是讓專案可以用一個本機指令快速檢查：

```text
API 路由是否存在
V1.3 必要 npm 指令是否存在
V1.3 必要 SQL / scripts 是否存在
前端主要頁籤是否存在
PWA 快取版本是否正確
線上 /health、/v13/status、/v13/acceptance 是否可用
```

---

## 二、本次版本

API 版本：

```text
stock-radar-api-v1.3.4.3
```

PWA 快取版本：

```text
stock-radar-pwa-v43
```

---

## 三、本次新增 API

```http
GET /v13/acceptance
```

用途：

```text
回傳 V1.3 正式定版前的驗收清單
包含 API、資料庫、前端 / PWA 三大區塊
提供建議驗收指令與建議檢查網址
```

---

## 四、本次新增 npm 指令

```bash
npm run v13:check
```

用途：

```text
本機靜態檢查 V1.3 專案完整度
```

也可檢查線上 API：

```bash
npm run v13:check -- --api=https://stock-radar-api-ten.vercel.app
```

---

## 五、檢查內容

### 1. 版本檢查

```text
API_VERSION 是否為 stock-radar-api-v1.3.4.3
PWA_EXPECTED_VERSION 是否為 stock-radar-pwa-v43
service-worker.js 是否為 stock-radar-pwa-v43
```

### 2. npm 指令檢查

```text
alerts:setup
alerts:generate
strategy-watchlists:setup
strategy-backtests:setup
strategy-backtests:generate
v13:check
```

### 3. 必要檔案檢查

```text
watchlist-alerts.sql
strategy-watchlists.sql
strategy-backtests.sql
setupWatchlistAlerts.js
generateWatchlistAlerts.js
setupStrategyWatchlists.js
setupStrategyBacktests.js
generateStrategyBacktests.js
checkV13.js
前端 index.html / app.js / style.css / service-worker.js
```

### 4. API 路由檢查

```text
GET /health
GET /v13/status
GET /v13/acceptance
GET /watchlist/alerts
GET /watchlist/alerts/unread-count
POST /watchlist/alerts/generate
GET /watchlist/rules
POST /watchlist/rules
GET /strategies
GET /strategies/definitions
GET /strategy-watchlist
GET /strategy-watchlist/performance
GET /strategy-watchlist/rankings
PATCH /strategy-watchlist/:trackId/risk-settings
GET /strategy-backtests/runs
GET /strategy-backtests/runs/:runId
GET /strategy-backtests/results
GET /strategy-backtests/summary
GET /strategy-backtests/rankings
```

### 5. 前端功能檢查

```text
提醒頁籤
策略選股頁籤
策略追蹤頁籤
策略回測頁籤
我的頁頁籤
V1.3 狀態 API 串接
策略回測 API 串接
策略追蹤停利停損 API 串接
```

---

## 六、建議驗收流程

### 1. 本機靜態檢查

```bash
cd D:\code\stock-radar\stock-radar-api
npm run v13:check
```

期待結果：

```text
結果：pass
失敗：0
```

### 2. 推送部署

```bash
cd D:\code\stock-radar

git status
git add .
git commit -m "V1.3-4-3 前端 API PWA 收尾驗收"
git push
```

### 3. 線上 API 檢查

```bash
cd D:\code\stock-radar\stock-radar-api
npm run v13:check -- --api=https://stock-radar-api-ten.vercel.app
```

期待結果：

```text
GET /health OK
GET /v13/status OK
GET /v13/acceptance OK
API 版本正確
/v13/status 為 pass 或可接受的 warn
```

### 4. 手動檢查網址

```text
https://stock-radar-api-ten.vercel.app/health
https://stock-radar-api-ten.vercel.app/v13/status
https://stock-radar-api-ten.vercel.app/v13/acceptance
```

---

## 七、V1.3 定版前剩餘事項

```text
1. 部署後跑 npm run v13:check -- --api=https://stock-radar-api-ten.vercel.app
2. 前端手機 / iPad 清快取後驗收
3. 確認我的頁 V1.3 狀態卡片正常
4. 確認策略回測頁正常
5. 確認提醒、策略追蹤、策略選股正常
6. 建立 V1.3 正式版 Git tag
```
