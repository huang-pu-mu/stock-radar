# V1.2 第 3 項：個股每月營收

## 完成內容

本次完成 V1.2 第 3 項「個股每月營收」。

新增功能：

1. 新增後端 API：

```text
GET /stock/:stockCode/revenue
```

測試範例：

```text
http://localhost:3000/stock/2330/revenue
```

2. 個股查詢頁新增「每月營收」區塊。

3. 股票「看明細」新增「每月營收」區塊。

4. 顯示內容包含：

```text
最新月份
當月營收
月增率
去年同月營收
年增率
累計營收
累計年增率
近月營收表格
營收成長判斷
```

5. 營收金額來源單位為仟元，前端顯示時換算成億元。

6. PWA 快取版本更新：

```text
stock-radar-pwa-v17
```

## 修改檔案

```text
stock-radar-api/server.js
stock-radar-frontend/app.js
stock-radar-frontend/style.css
stock-radar-frontend/service-worker.js
```

## 注意事項

1. 這次不用新增資料表。
2. 營收資料目前採即時讀取 Yahoo 股市營收頁。
3. 若資料來源暫時擋住或沒有回傳，畫面會顯示「每月營收暫時讀不到」，不會影響原本股票明細。
4. 若手機 PWA 沒看到新區塊，請重新整理或重新安裝 APP。
