# V1.2.10 EPS 匯入第二次修正說明

## 修正原因

`npm run official:eps` 執行時，MOPS 舊網域可回傳頁面但無法解析 EPS 資料，導致 `quarterly_eps` 維持 0 筆。

## 修正內容

1. `stock-radar-api/scripts/importQuarterlyEps.js`
   - 新增優先使用 `mopsov.twse.com.tw`。
   - 保留 `mops.twse.com.tw` 作為備援。
   - 同時嘗試季度參數 `01` 與 `1`。
   - 補上 `isnew=false` 參數備援。
   - 失敗時輸出前段回應文字，方便判斷是無資料、錯誤頁或格式變更。

## 執行方式

```powershell
cd D:\code\stock-radar\stock-radar-api
npm run official:eps
```

## 檢查 SQL

```sql
USE stock_radar;

SELECT COUNT(*) AS total_count FROM quarterly_eps;

SELECT *
FROM quarterly_eps
ORDER BY eps_year DESC, eps_quarter DESC, stock_code
LIMIT 20;
```
