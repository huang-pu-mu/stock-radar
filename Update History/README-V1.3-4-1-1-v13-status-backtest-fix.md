# V1.3-4-1-1：修正 /v13/status 策略回測狀態判斷

## 修正原因

`/v13/status` 可以正常打開，但 `strategy_backtests` 顯示 `warn`，訊息為「尚未找到完成且有訊號的策略回測任務」。

實際資料庫中：

```text
strategy_backtest_runs 有資料
strategy_backtest_results 有資料
Run ID 3 已完成且有 7826 筆訊號
```

問題原因是狀態檢查查詢使用了舊欄位名稱，例如：

```text
trading_day_count
avg_return_1d_percent
finished_at
result_status
signal_date
```

但目前 V1.3-3-1 的正式資料表欄位是：

```text
trading_days_count
avg_return_1d
completed_at
outcome_label
signal_trade_date
```

因此 `/v13/status` 無法正確抓到最新完成回測。

## 修正內容

### 1. API 版本更新

```text
stock-radar-api-v1.3.4.1.1
```

### 2. 修正策略回測結果表最新日期欄位

```text
strategy_backtest_results：signal_date → signal_trade_date
```

### 3. 修正最新完成回測查詢

改為使用正式欄位：

```text
trading_days_count
avg_return_1d
avg_return_3d
avg_return_5d
win_rate_1d
win_rate_3d
win_rate_5d
completed_at
```

並只抓：

```text
status = completed
signal_count > 0
```

### 4. 修正策略統計查詢

改為使用：

```text
outcome_label
```

取代舊欄位：

```text
result_status
```

## 驗收方式

部署後檢查：

```text
https://stock-radar-api-ten.vercel.app/health
https://stock-radar-api-ten.vercel.app/v13/status
```

期待結果：

```text
/health version = stock-radar-api-v1.3.4.1.1
/v13/status strategy_backtests = pass
/v13/status latest_run = Run ID 3 或最新完成 Run
/v13/status latest_backtest_strategy_stats 有各策略統計
overall_status = pass 或只剩可接受 warn
```
