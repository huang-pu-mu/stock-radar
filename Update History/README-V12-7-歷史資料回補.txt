V1.2-7：歷史資料回補

本次完成項目：

1. 新增市場每日成交總覽歷史回補

指令：

  npm run official:market:history -- 2026-01-01 2026-06-18

說明：

- 可指定起訖日期。
- 預設略過週末。
- 如果該日期 market_daily_summaries 已有上市、上櫃兩筆資料，會自動略過。
- 如果需要強制重新匯入，可加 --force。
- 上市市場會優先嘗試 TWSE FMTQIK 官方資料。
- 上市官方來源讀不到時，會改用 daily_prices 彙總。
- 上櫃市場目前使用 daily_prices 彙總回補。
- 休市日或沒有 daily_prices 的日期會顯示「略過無資料 / 休市」，不中斷整批流程。

範例：

  npm run official:market:history -- 2026-01-01 2026-06-18
  npm run official:market:history -- --start=2026-01-01 --end=2026-06-18
  npm run official:market:history -- 2026-01-01 2026-06-18 --force


2. 新增三大法人官方金額歷史回補

指令：

  npm run official:institutional-amounts:history -- 2026-01-01 2026-06-18

說明：

- 可指定起訖日期。
- 預設略過週末。
- 如果該日期 institutional_amount_summaries 已有上市、上櫃兩筆資料，會自動略過。
- 如果需要強制重新匯入，可加 --force。
- 上市使用既有 TWSE BFI82U 來源。
- 上櫃使用既有 TPEx 三大法人買賣金額統計來源。
- 休市日或官方來源查無資料會顯示「略過無資料 / 休市」，不中斷整批流程。

範例：

  npm run official:institutional-amounts:history -- 2026-01-01 2026-06-18
  npm run official:institutional-amounts:history -- --start=2026-01-01 --end=2026-06-18
  npm run official:institutional-amounts:history -- 2026-01-01 2026-06-18 --force


3. 原本每日匯入指令仍可使用

以下指令不變：

  npm run official:market
  npm run official:institutional-amounts
  npm run official:daily

這次只是新增「歷史回補」，不會改變每日排程主流程。


4. V1.2 檢查機制更新

npm run v12:check 現在也會檢查：

- stock-radar-api/scripts/backfillMarketDailySummaries.js
- stock-radar-api/scripts/backfillInstitutionalAmountSummaries.js
- npm run official:market:history
- npm run official:institutional-amounts:history


5. 建議執行順序

先小範圍測試：

  npm run official:market:history -- 2026-06-16 2026-06-18
  npm run official:institutional-amounts:history -- 2026-06-16 2026-06-18

確認正常後再補較長區間：

  npm run official:market:history -- 2026-01-01 2026-06-18
  npm run official:institutional-amounts:history -- 2026-01-01 2026-06-18

最後檢查：

  npm run v12:check
