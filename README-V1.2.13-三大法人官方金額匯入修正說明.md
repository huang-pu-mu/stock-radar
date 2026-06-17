# V1.2.13 三大法人官方金額匯入修正說明

## 修正目標

修正 `npm run official:institutional-amounts` 匯入失敗問題。

## 原本錯誤

```text
上市 找不到三大法人金額表，回傳 keys：stat, date, title, fields, data, params, notes, hints
上櫃 回傳狀態：ok
```

## 修正內容

1. 修正 TWSE 官方回傳欄位解析：
   - 原本只認 `買賣超`
   - 現在同時支援 `買賣差額`、`差額`

2. 修正 TPEx 狀態判斷：
   - 原本只接受大寫 `OK`
   - 現在可接受小寫 `ok`

3. 加強錯誤訊息：
   - 若仍找不到表格，會印出 table hints，方便後續定位官方回傳格式。

4. 補強金額轉數字：
   - 支援括號負數，例如 `(12345)` 會解析為 `-12345`

## 修改檔案

```text
stock-radar-api/scripts/importInstitutionalAmountSummaries.js
```

## 測試指令

```powershell
cd D:\code\stock-radar\stock-radar-api
npm run official:institutional-amounts
```

或指定日期：

```powershell
npm run official:institutional-amounts -- 2026-06-17
```

## 檢查資料

```sql
USE stock_radar;

SELECT COUNT(*) AS total_count
FROM institutional_amount_summaries;

SELECT *
FROM institutional_amount_summaries
ORDER BY trade_date DESC, market_type
LIMIT 20;
```
