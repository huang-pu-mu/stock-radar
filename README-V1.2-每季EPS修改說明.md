# V1.2 第 4 項：每季 EPS / 盈餘狀況

本次以最新附件程式碼為基準，完成「每季 EPS / 盈餘狀況」。

## 完成內容

1. 新增後端 API：`GET /stock/:stockCode/eps`
2. 個股查詢頁新增「每季 EPS / 盈餘狀況」區塊
3. 看明細頁新增「每季 EPS / 盈餘狀況」區塊
4. 顯示最新季度、EPS、季增率、年增率、近四季 EPS 合計、近四季平均 EPS
5. 顯示近季 EPS 表格
6. 新增 EPS 成長狀態判斷
7. PWA 快取版本更新到 `stock-radar-pwa-v18`

## 測試方式

```powershell
cd D:\code\stock-radar\stock-radar-api
npm run dev
```

瀏覽器測試：

```text
http://localhost:3000/stock/2330/eps
```

前端測試：

```text
個股查詢 > 輸入 2330 > 查詢
```

或在今日雷達 / 自選股 / 排行列表點「看明細」。

## 注意

這次不用新增資料表。EPS 先以 Yahoo 股市 EPS 頁為主要來源，若頁面解析不到，會嘗試使用 Yahoo Finance quoteSummary 做備援。
