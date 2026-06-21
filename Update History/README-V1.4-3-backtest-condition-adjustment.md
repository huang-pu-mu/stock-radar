# V1.4-3：回測條件調整

## 本次目標

把 V1.4-2 的「策略參數最佳化」接到「策略回測」，讓回測可以用不同參數預設產生不同 Run ID，後續方便比較勝率、平均報酬與樣本數。

## 完成項目

1. `npm run strategy-backtests:generate` 支援 `--preset`。
2. 支援保守 / 平衡 / 積極三組回測參數。
3. 支援自訂回測門檻：
   - `--min_strategy_score`
   - `--min_chip_score`
   - `--min_legal_score`
   - `--min_volume_score`
   - `--min_price_score`
   - `--min_total_net_lots`
   - `--min_large_holder_ratio_change`
   - `--event_window_days`
4. 支援 `--start-date`、`--end-date`。
5. 回測產生時會把參數寫入 `strategy_backtest_runs.params_json`。
6. API `/strategy-backtests/runs` 與 `/strategy-backtests/summary` 回傳 `params_json`。
7. 前端策略回測頁新增「回測條件調整」面板。
8. 前端可產生本機 npm 指令並複製。
9. 回測總覽顯示 Run 使用的參數預設與最低策略 / 籌碼門檻。
10. V1.4 驗收檢查更新到 API v1.4.3.0 / PWA v49。

## 指令範例

```bash
cd D:\code\stock-radar\stock-radar-api
npm run strategy-backtests:generate -- --preset=balanced --limit=30 --max-days=80
```

```bash
cd D:\code\stock-radar\stock-radar-api
npm run strategy-backtests:generate -- --start-date=2026-01-01 --end-date=2026-06-21 --preset=conservative --strategy=legal_strength --market=上市 --limit=30 --max-days=120
```

```bash
cd D:\code\stock-radar\stock-radar-api
npm run strategy-backtests:generate -- --preset=aggressive --min_chip_score=60 --min_volume_score=8 --event_window_days=45
```

## 驗收方式

```bash
cd D:\code\stock-radar
node --check stock-radar-frontend\app.js
node --check stock-radar-api\server.js
node --check stock-radar-api\scripts\generateStrategyBacktests.js

cd stock-radar-api
npm run v14:check
```

預期：`結果：pass`。
