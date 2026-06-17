# V1.2 第 5 項：個股行事曆修改說明

## 完成內容

本次新增個股行事曆功能，對應需求：配息日期、除息日期、除權日期、股東會日期、法說會日期、停券日期與其他重要事件。

## 後端新增 API

```text
GET /stock/:stockCode/calendar
```

測試範例：

```text
http://localhost:3000/stock/2330/calendar
```

可選參數：

```text
?limit=40
```

## 前端新增顯示位置

1. 個股查詢頁
2. 今日雷達 / 自選股 / 排行列表的「看明細」視窗

## 顯示內容

1. 下一個事件
2. 下一個事件日期
3. 距離今天幾天
4. 未來事件數量
5. 配息 / 除息事件數
6. 股東會事件數
7. 法說會事件數
8. 近期行事曆事件列表

## 資料來源

主要來源：

```text
Yahoo 股市個股行事曆頁
https://tw.stock.yahoo.com/quote/2330.TW/calendar
```

備援來源：

```text
Yahoo Finance quoteSummary calendarEvents / summaryDetail
```

## 修改檔案

1. `stock-radar-api/server.js`
2. `stock-radar-frontend/app.js`
3. `stock-radar-frontend/style.css`
4. `stock-radar-frontend/service-worker.js`

## PWA 快取版本

```js
stock-radar-pwa-v19
```

## 注意事項

1. 這次不用新增資料表。
2. 行事曆資料需要 API 主機可以連外讀取 Yahoo。
3. 如果 Yahoo 頁面格式變動，畫面會顯示「個股行事曆暫時讀不到」，不會影響原本股票明細。
4. 手機 PWA 如果沒看到新區塊，請重新整理或重新安裝 APP。
