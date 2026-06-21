# V1.4.8.2 策略最佳化與回測整合補強

## 版本

- API：stock-radar-api-v1.4.8.2
- PWA：stock-radar-pwa-v56

## 本次重點

- 策略最佳化頁新增「保守 / 平衡 / 積極回測比較」。
- 新增 `/strategy-optimization/backtest-comparison` API。
- 可依 1 日 / 3 日 / 5 日 / 目前報酬比較不同參數預設。
- 顯示勝率、平均報酬、有效樣本、Run 數與目前推薦參數。
- 顯示策略別最佳參數，用來判斷不同策略適合哪組門檻。
- 更新 V1.4 系統狀態與 `npm run v14:check` 檢查項目。

## 新增 API

```http
GET /strategy-optimization/backtest-comparison?metric=5d&strategy=legal_strength&market=上市&limit=60
```

## 注意事項

此功能直接讀取既有資料表，不需要新增 SQL：

- strategy_backtest_runs
- strategy_backtest_results

若比較區顯示資料不足，請先分別產生 balanced / conservative / aggressive 的回測 Run。
