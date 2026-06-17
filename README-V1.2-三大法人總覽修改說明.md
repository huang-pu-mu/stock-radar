# V1.2 第 7 項：三大法人買賣總金額、分別金額

## 本次完成

新增「法人總覽」頁面，提供每日三大法人整體買賣超方向。

## 後端新增 API

```text
GET /market/institutional/summary?market=上市&date=YYYY-MM-DD&days=10
```

可省略參數：

```text
GET /market/institutional/summary
```

回傳內容包含：

- 資料日
- 市場別：全部 / 上市 / 上櫃
- 外資買進張數、賣出張數、買賣超張數
- 投信買進張數、賣出張數、買賣超張數
- 自營商買賣超張數
- 三大法人合計買賣超張數
- 外資買賣超估算金額
- 投信買賣超估算金額
- 自營商買賣超估算金額
- 三大法人合計估算金額
- 上市 / 上櫃分別彙總
- 近 10 日法人合計趨勢
- 法人估算買超前 5
- 法人估算賣超前 5

## 金額估算方式

目前資料表 `institutional_trades` 儲存的是法人買賣超張數，不是官方成交金額。

所以這次金額先用：

```text
買賣超張數 × 收盤價 × 1000
```

這樣可以快速看法人資金流入或流出方向。

## 前端新增

新增頁籤：

```text
法人總覽
```

畫面包含：

- 三大法人合計金額大卡
- 外資 / 投信 / 自營商 / 合計分別卡
- 上市 / 上櫃分別金額
- 近 10 日法人趨勢條
- 法人估算買超前 5
- 法人估算賣超前 5

## 修改檔案

- `stock-radar-api/server.js`
- `stock-radar-frontend/index.html`
- `stock-radar-frontend/app.js`
- `stock-radar-frontend/style.css`
- `stock-radar-frontend/service-worker.js`

## 測試方式

啟動 API：

```powershell
cd D:\code\stock-radar\stock-radar-api
npm run dev
```

測試 API：

```text
http://localhost:3000/market/institutional/summary
```

只看上市：

```text
http://localhost:3000/market/institutional/summary?market=上市
```

只看上櫃：

```text
http://localhost:3000/market/institutional/summary?market=上櫃
```

前端測試：

```text
點選「法人總覽」頁籤
```

## 注意

- 這次不用新增資料表。
- 需要每日匯入 `institutional_trades` 與 `daily_prices` 後才會有資料。
- 金額為估算值，不是官方直接揭露的法人成交金額。
- PWA 快取版本已更新為 `stock-radar-pwa-v21`。
