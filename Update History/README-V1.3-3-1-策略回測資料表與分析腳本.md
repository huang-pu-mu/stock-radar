# V1.3-3-1：策略回測資料表與分析腳本

## 本次目標

建立策略回測基礎功能，讓系統可以把歷史日期的策略選股結果寫入資料庫，並計算後續 1 / 3 / 5 個交易日報酬。

---

## 新增資料表

```text
strategy_backtest_runs
strategy_backtest_results
```

### strategy_backtest_runs

用途：

```text
記錄每一次回測任務
```

包含：

```text
回測起訖日期
市場別
指定策略
每策略每日上限
交易日數
訊號數
成功 / 觀察 / 失敗 / 待資料統計
1日 / 3日 / 5日平均報酬
1日 / 3日 / 5日勝率
回測參數 JSON
回測摘要 JSON
執行狀態
```

### strategy_backtest_results

用途：

```text
記錄每一筆策略訊號的後續表現
```

包含：

```text
策略名稱
股票代號
股票名稱
訊號日期
策略分數
觸發原因
進場價
1日後價格與報酬
3日後價格與報酬
5日後價格與報酬
最新價格與目前報酬
成功 / 觀察 / 失敗 / 待資料
```

---

## 新增指令

建立資料表：

```bash
npm run strategy-backtests:setup
```

產生回測：

```bash
npm run strategy-backtests:generate -- 2026-01-01 2026-06-18
```

指定單一策略：

```bash
npm run strategy-backtests:generate -- 2026-01-01 2026-06-18 --strategy=legal_strength
```

指定市場：

```bash
npm run strategy-backtests:generate -- 2026-01-01 2026-06-18 --market=上市
```

限制每策略每日筆數：

```bash
npm run strategy-backtests:generate -- 2026-01-01 2026-06-18 --limit=20
```

限制最多交易日數：

```bash
npm run strategy-backtests:generate -- 2026-01-01 2026-06-18 --max-days=60
```

---

## 支援策略

```text
legal_strength：法人轉強股
major_holder_accumulate：主力增持股
volume_price_breakout：量價轉強股
capital_inflow：資金流入股
etf_calendar_watch：ETF 除息觀察
short_term_strong：短線強勢股
```

---

## 回測判斷邏輯

```text
訊號日：策略在歷史日期選出的股票
進場價：訊號日當天或訊號日前最近收盤價
1日報酬：訊號日後第 1 個交易日收盤價相對進場價
3日報酬：訊號日後第 3 個交易日收盤價相對進場價
5日報酬：訊號日後第 5 個交易日收盤價相對進場價
目前報酬：最新收盤價相對進場價
```

---

## 成功 / 失敗判斷

```text
5日報酬或目前報酬 >= 3%：success
5日報酬或目前報酬 <= -3%：fail
-3% ~ 3%：neutral
價格資料不足：pending
```

---

## SQL 驗收

查最近回測任務：

```sql
SELECT *
FROM strategy_backtest_runs
ORDER BY id DESC
LIMIT 5;
```

查某次回測最佳股票：

```sql
SELECT *
FROM strategy_backtest_results
WHERE run_id = 1
ORDER BY return_5d_percent DESC
LIMIT 20;
```

查策略平均報酬：

```sql
SELECT
  strategy_key,
  strategy_name,
  COUNT(*) AS signal_count,
  AVG(return_1d_percent) AS avg_1d,
  AVG(return_3d_percent) AS avg_3d,
  AVG(return_5d_percent) AS avg_5d
FROM strategy_backtest_results
WHERE run_id = 1
GROUP BY strategy_key, strategy_name
ORDER BY avg_5d DESC;
```

---

## 注意事項

```text
這版只建立回測資料表與產生腳本。
前端回測頁、回測 API、回測排行榜會放在後續版本繼續做。
回測結果只用來檢查策略歷史表現，不代表未來獲利保證。
```
