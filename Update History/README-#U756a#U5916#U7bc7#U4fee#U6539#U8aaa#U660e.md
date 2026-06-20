# 股票 PWA 番外篇修改說明

## 已完成

1. 看明細新增 MA5、MA10、MA20、MA60、MA120、MA240。
2. 看明細新增股價走勢圖：K 線加 MA5 ~ MA240。
3. 看明細新增成交量走勢圖：成交量加 MV5、MV20。
4. 自選股頁面新增上移、下移，可以調整順序。
5. 後端新增 `PATCH /watchlist/order`，用來儲存自選股排序。
6. 籌碼分數計算改抓最多 260 筆歷史價格，避免 MA 與成交量只看到短資料。
7. 成交量與股價位置資料不足時，改成顯示資料累積或短期判斷，不再只顯示「歷史資料不足」。

## 必做

### 1. 先執行 SQL

在 HeidiSQL 執行：

```sql
stock-radar-api/sql/watchlists-sort-order.sql
```

用途：新增自選股排序欄位 `sort_order`。

### 2. 覆蓋檔案

覆蓋這些檔案：

```text
stock-radar-frontend/app.js
stock-radar-frontend/style.css
stock-radar-api/server.js
stock-radar-api/scripts/calculateChipScores.js
stock-radar-api/sql/watchlists.sql
```

新增這些檔案：

```text
stock-radar-api/sql/watchlists-sort-order.sql
tools/import-history.ps1
```

### 3. 補歷史資料

MA240 需要至少 240 個交易日資料。若只匯入最近一天，MA240 一定會顯示資料不足。

建議先補一年：

```powershell
cd D:\code\stock-radar
powershell -ExecutionPolicy Bypass -File .\tools\import-history.ps1 -StartDate "2025-06-01" -EndDate "2026-06-16"
```

如果只想讓成交量與股價位置先正常，至少補 20 個交易日。

### 4. 本機測試

```powershell
cd D:\code\stock-radar\stock-radar-api
npm run dev
```

再打開前端測：

```text
自選股 → 看明細
```

## 上傳 GitHub

```powershell
cd D:\code\stock-radar

git status
git add .
git commit -m "新增技術圖表與自選股排序"
git push
```
