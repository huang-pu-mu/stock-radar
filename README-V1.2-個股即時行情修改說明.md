# V1.2 第 2 項：個股即時行情修改說明

## 完成項目

本次接續 V1.2 開發順序，完成第 2 項「個股即時行情」。

已新增：

1. 個股即時行情 API
2. 個股查詢頁顯示即時行情
3. 看明細頁顯示即時行情
4. 五檔委買委賣
5. 內外盤參考區塊
6. PWA 快取版本更新

---

## 後端新增 API

```text
GET /stock/:stockCode/realtime
```

範例：

```text
http://localhost:3000/stock/2330/realtime
```

回傳重點欄位：

```text
stock_code
stock_name
market_type
trade_date
latest_time
current_price
price_change
change_percent
open_price
high_price
low_price
previous_close
volume_lots
latest_volume_lots
total_trade_amount
bid_price
ask_price
bid_levels
ask_levels
inner_volume_lots
outer_volume_lots
trade_side
trade_side_note
source
updated_at
```

---

## 資料來源

個股即時行情目前使用：

```text
TWSE MIS 即時行情
```

上市股票優先查：

```text
tse_股票代號.tw
```

上櫃股票優先查：

```text
otc_股票代號.tw
```

程式也有做備援：

1. 上市查不到時，會再帶上櫃 channel。
2. 上櫃查不到時，會再帶上市 channel。

---

## 前端更新位置

### 1. 個股查詢頁

輸入股票代號後，會同時查：

```text
/stock/:stockCode/summary
/stock/:stockCode/realtime
```

畫面會新增：

1. 現價
2. 漲跌
3. 漲跌幅
4. 開盤
5. 最高
6. 最低
7. 昨收
8. 成交量
9. 單筆量
10. 成交金額
11. 內外盤參考
12. 五檔委買委賣

### 2. 看明細頁

點股票卡片的「看明細」後，也會多查：

```text
/stock/:stockCode/realtime
```

並在最上方加入「盤中即時行情」區塊。

---

## 內外盤處理方式

如果資料來源有提供內盤量、外盤量，畫面會直接顯示。

如果資料來源沒有提供累計內外盤量，畫面會先用：

```text
最新成交價 vs 五檔委買委賣
```

做參考判斷：

1. 最新成交價接近委賣價：顯示「外盤參考」
2. 最新成交價接近委買價：顯示「內盤參考」
3. 介於中間：顯示「買賣中間」

---

## 修改檔案

```text
stock-radar-api/server.js
stock-radar-frontend/app.js
stock-radar-frontend/style.css
stock-radar-frontend/service-worker.js
README-V1.2-個股即時行情修改說明.md
```

---

## PWA 快取版本

已由：

```text
stock-radar-pwa-v15
```

更新為：

```text
stock-radar-pwa-v16
```

---

## 本機測試方式

### 1. 啟動 API

```powershell
cd D:\code\stock-radar\stock-radar-api
npm run dev
```

### 2. 測試新 API

```text
http://localhost:3000/stock/2330/realtime
```

### 3. 前端測試

```text
個股查詢 > 輸入 2330 > 查詢
```

或：

```text
任何股票卡片 > 看明細
```

---

## 注意事項

1. 這次不用新增資料表。
2. 即時行情需要 API 主機可以連外讀取 TWSE MIS。
3. 若盤後或資料源暫時沒有回傳，畫面會保留區塊並顯示讀取提醒。
4. 如果手機 PWA 沒更新畫面，請重新整理或重新安裝 APP。
