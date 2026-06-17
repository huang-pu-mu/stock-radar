# V1.2.12 三大法人官方金額匯入

## 本次目的

補上 `institutional_amount_summaries` 的匯入流程，讓「法人總覽」優先讀取官方/市場總覽金額，不再只靠「張數 × 收盤價 × 1000」估算。

## 新增檔案

```text
stock-radar-api/scripts/importInstitutionalAmountSummaries.js
```

## 修改檔案

```text
stock-radar-api/package.json
stock-radar-api/server.js
```

## 新增 npm 指令

```powershell
npm run official:institutional-amounts
```

可指定日期：

```powershell
npm run official:institutional-amounts -- 2026-06-17
```

## official:daily 已更新

`official:daily` 已加入三大法人官方金額匯入：

```text
market + revenue + eps + etf + events + institutional-amounts
```

## 匯入資料表

```text
institutional_amount_summaries
```

## 匯入欄位

```text
foreign_buy_amount
foreign_sell_amount
foreign_net_amount
investment_trust_buy_amount
investment_trust_sell_amount
investment_trust_net_amount
dealer_buy_amount
dealer_sell_amount
dealer_net_amount
total_buy_amount
total_sell_amount
total_net_amount
source
source_url
```

## API 調整

`GET /market/institutional/summary` 已調整最新日期判斷。

原本只看：

```text
institutional_trades
```

現在會同時看：

```text
institutional_trades
institutional_amount_summaries
```

避免只有官方金額表有資料時，法人總覽找不到最新日期。

## 執行方式

```powershell
cd D:\code\stock-radar\stock-radar-api
npm run official:institutional-amounts
```

## 執行後檢查

```sql
USE stock_radar;

SELECT COUNT(*) AS total_count
FROM institutional_amount_summaries;

SELECT *
FROM institutional_amount_summaries
ORDER BY trade_date DESC, market_type
LIMIT 20;
```

## 注意

1. 若上市或上櫃其中一個來源暫時讀不到，腳本會略過該市場，另一個市場仍可寫入。
2. 若兩個市場都失敗，指令才會以失敗結束。
3. 成功後法人總覽會顯示 `official_amount_available: true`。
