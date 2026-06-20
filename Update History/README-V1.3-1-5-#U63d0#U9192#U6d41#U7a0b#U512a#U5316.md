# V1.3-1-5 提醒流程優化

## 本版目標

完成提醒中心的使用流程優化，讓使用者修改提醒規則後，可以在 APP 內立即重新分析提醒，不必等待每日排程。

## 修改內容

### 1. 後端新增立即重新分析 API

新增 API：

```http
POST /watchlist/alerts/generate
```

功能：

```text
依照目前登入者的自選股與提醒規則，立即重新產生提醒。
```

可選參數：

```json
{
  "date": "2026-06-20"
}
```

若沒有指定日期，會使用台灣今日日期，並自動往前找最近可用交易日。

---

### 2. 提醒產生腳本模組化

修改：

```text
stock-radar-api/scripts/generateWatchlistAlerts.js
```

新增匯出：

```js
export async function generateWatchlistAlerts(options = {})
```

支援：

```text
CLI 執行 npm run alerts:generate
API 直接呼叫 generateWatchlistAlerts()
指定 userId 只分析目前登入者
不會在 API 呼叫時關閉共用 pool
```

---

### 3. 前端提醒中心新增立即重新分析

提醒中心新增按鈕：

```text
立即重新分析
```

按下後會呼叫：

```http
POST /watchlist/alerts/generate
```

完成後會：

```text
切回未讀提醒
重新載入提醒清單
更新未讀提醒數
顯示交易日、符合提醒筆數、啟用規則數
```

---

### 4. 提醒設定儲存後提示優化

修改提醒設定後，會提示：

```text
可回提醒中心按「立即重新分析」套用新條件。
```

---

### 5. PWA 快取版本

更新：

```text
stock-radar-pwa-v32
```

## 修改檔案

```text
stock-radar-api/server.js
stock-radar-api/scripts/generateWatchlistAlerts.js
stock-radar-frontend/app.js
stock-radar-frontend/style.css
stock-radar-frontend/service-worker.js
Update History/README-V1.3-1-5-提醒流程優化.md
```

## 驗收方式

### 後端 API

登入後呼叫：

```http
POST /watchlist/alerts/generate
```

正常會回：

```json
{
  "success": true,
  "message": "自選股提醒已重新分析",
  "data": {
    "trade_date": "2026-06-18",
    "generated_count": 13,
    "active_rules": 5
  }
}
```

### 前端

```text
提醒頁籤 → 立即重新分析
```

檢查：

```text
按鈕可執行
分析中會顯示處理狀態
完成後會重新載入未讀提醒
提醒 badge 會更新
畫面會顯示剛剛已重新分析資訊
```
