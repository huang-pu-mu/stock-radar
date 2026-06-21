# V1.4-6 策略勝率趨勢

## 本次目標

新增策略勝率趨勢頁面，讓回測結果不只看單次 Run，也能比較最近多次 Run 的勝率、平均報酬與策略穩定度。

## 完成項目

1. 新增 API：`GET /strategy-backtests/trends`
2. 新增前端頁面：策略中心 → 勝率趨勢
3. 手機策略次功能新增「趨勢」
4. 支援切換 1 日 / 3 日 / 5 日 / 目前報酬指標
5. 支援篩選單一策略或全部策略
6. 支援依目前市場篩選上市 / 上櫃 / 全部
7. 顯示最近多次回測 Run 勝率趨勢
8. 顯示各策略最新勝率、平均報酬、勝率變化
9. 更新 V1.4 驗收檢查

## 新增 API

```http
GET /strategy-backtests/trends?metric=5d&limit=12
GET /strategy-backtests/trends?metric=3d&strategy=legal_strength&market=上市&limit=12
```

## API 回傳內容

- `summary`：最新 Run、最新勝率、勝率變化、最新平均報酬、最佳策略
- `run_trend`：最近多次 Run 的勝率趨勢
- `strategy_trends`：各策略在不同 Run 中的勝率趨勢

## 版本

- API：`stock-radar-api-v1.4.6.0`
- PWA Cache：`stock-radar-pwa-v52`

## 注意

本功能直接讀取既有資料表：

- `strategy_backtest_runs`
- `strategy_backtest_results`

因此本次不需要新增 SQL，也不需要執行新的 setup 指令。
