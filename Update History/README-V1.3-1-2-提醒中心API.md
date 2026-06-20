# V1.3-1-2：提醒中心 API

## 一、本次完成內容

本次接續 V1.3-1-1 的自選股提醒資料表與提醒產生腳本，新增後端提醒中心 API。

已完成：

```text
GET /watchlist/alerts
GET /watchlist/alerts/unread-count
POST /watchlist/alerts/:alertId/read
POST /watchlist/alerts/read-all
GET /watchlist/rules
POST /watchlist/rules
```

以上 API 都需要 Google 登入後的 Bearer Token，資料會依照目前登入者 `req.user.id` 查詢，不會看到其他使用者的提醒。

---

## 二、提醒中心 API

### 1. 查詢提醒清單

```http
GET /watchlist/alerts
```

可用參數：

```text
limit=50
offset=0
unread=1
is_read=0
stock_code=2330
alert_type=volume_spike
alert_level=high
from=2026-06-01
to=2026-06-30
```

範例：

```http
GET /watchlist/alerts?limit=20&unread=1
```

回傳重點：

```text
success
count
total_count
summary.total_count
summary.unread_count
summary.high_count
summary.latest_alert_date
summary.by_type
data
```

---

### 2. 查詢未讀提醒數

```http
GET /watchlist/alerts/unread-count
```

回傳：

```text
unread_count
high_unread_count
latest_alert_date
```

---

### 3. 單筆提醒標記已讀

```http
POST /watchlist/alerts/:alertId/read
```

範例：

```http
POST /watchlist/alerts/13/read
```

---

### 4. 全部提醒標記已讀

```http
POST /watchlist/alerts/read-all
```

也可以只標記某檔股票：

```http
POST /watchlist/alerts/read-all?stock_code=2330
```

或 body：

```json
{
  "stock_code": "2330"
}
```

---

## 三、提醒規則 API

### 1. 查詢提醒規則

```http
GET /watchlist/rules
```

查詢單一股票：

```http
GET /watchlist/rules?stock_code=2330
```

此 API 會自動幫目前自選股補齊預設提醒規則。

---

### 2. 新增 / 更新提醒規則

```http
POST /watchlist/rules
```

範例：

```json
{
  "stock_code": "2330",
  "is_active": 1,
  "foreign_buy_streak_enabled": 1,
  "foreign_buy_streak_days": 3,
  "investment_trust_buy_streak_enabled": 1,
  "investment_trust_buy_streak_days": 3,
  "major_holder_enabled": 1,
  "major_holder_ratio_change_threshold": 0.3,
  "volume_enabled": 1,
  "volume_ratio_threshold": 1.5,
  "chip_score_enabled": 1,
  "chip_score_threshold": 80,
  "calendar_enabled": 1,
  "calendar_days_before": 14
}
```

注意：

```text
股票必須先加入自選股，才能設定提醒規則。
```

---

## 四、本機測試方式

### 1. 啟動 API

```bash
cd D:\code\stock-radar\stock-radar-api
npm run dev
```

### 2. 前端登入 Google

登入後前端 localStorage 會有 token。

### 3. 用瀏覽器或 API 工具測試

需要帶：

```http
Authorization: Bearer 你的登入Token
```

若沒有帶 token，會回傳：

```json
{
  "success": false,
  "message": "請先登入 Google 帳號。"
}
```

---

## 五、下一步

下一步建議做：

```text
V1.3-1-3：前端提醒中心頁面
```

前端要新增：

```text
提醒頁籤
未讀提醒數
提醒卡片列表
高重要性提醒樣式
標記已讀
全部已讀
提醒規則設定入口
```
