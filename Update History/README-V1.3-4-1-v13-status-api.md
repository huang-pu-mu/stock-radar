# V1.3-4-1：V1.3 系統狀態檢查 API

## 本次目標

新增 V1.3 收尾用的後端狀態檢查 API，讓前端「我的」頁後續可以直接顯示 V1.3 功能是否完整。

## 新增 API

### GET /health

用途：

```text
快速檢查 API 與 MariaDB 是否可連線。
```

回傳重點：

```text
API 版本
PWA 預期版本
資料庫名稱
資料庫時間
檢查時間
```

---

### GET /v13/status

用途：

```text
檢查 V1.3 主要功能狀態。
```

檢查內容：

```text
MariaDB 連線
核心行情 / 籌碼資料表
V1.3 自選股提醒資料表
V1.3 策略追蹤資料表
V1.3 停利停損欄位
V1.3 策略回測資料表
最新策略回測任務
各策略回測統計
```

## 會檢查的核心資料表

```text
stocks
daily_prices
institutional_trades
chip_scores
major_holder_stats
stock_calendar_events
```

## 會檢查的 V1.3 資料表

```text
watchlist_alert_rules
watchlist_alerts
strategy_watchlists
strategy_backtest_runs
strategy_backtest_results
```

## 回傳狀態

```text
pass：正常
warn：功能可用，但資料量或欄位需要確認
fail：必要資料表或資料庫狀態異常
```

## 驗收網址

```text
https://stock-radar-api-ten.vercel.app/health
https://stock-radar-api-ten.vercel.app/v13/status
```

## 本次修改檔案

```text
stock-radar-api/server.js
Update History/README-V1.3-4-1-v13-status-api.md
```
