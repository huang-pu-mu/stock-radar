# V1.4-7 個股策略歷史紀錄

## 版本

- API：stock-radar-api-v1.4.7.0
- PWA Cache：stock-radar-pwa-v53

## 完成內容

1. 新增「個股歷史」頁面。
2. 桌機左側策略中心新增「個股歷史」。
3. 手機策略次功能新增「歷史」。
4. 新增 `GET /strategy-backtests/stock-history` API。
5. 支援單一股票代號查詢。
6. 支援 1 日 / 3 日 / 5 日 / 目前報酬切換。
7. 支援全部策略 / 單一策略篩選。
8. 支援上市 / 上櫃 / 全部市場篩選。
9. 顯示個股歷史訊號總數、命中策略數、Run 數、勝率、平均報酬。
10. 顯示策略分布、Run ID 分布、歷史訊號清單。
11. 策略回測結果卡片新增「策略歷史」快捷按鈕。
12. 更新 `npm run v14:check` 驗收檢查。

## 新增 API

```http
GET /strategy-backtests/stock-history?stock_code=2330&metric=5d
```

可用參數：

```text
stock_code
metric=1d|3d|5d|latest
strategy=legal_strength
market=上市|上櫃
limit=100
sort=signal_desc|signal_asc|metric_desc|metric_asc|score_desc|score_asc
```

## 本次沒有新增 SQL

本功能直接使用既有資料表：

- strategy_backtest_runs
- strategy_backtest_results
- stocks

