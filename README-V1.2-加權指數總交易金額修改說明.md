# V1.2 第 1-1 項：加權指數、漲跌數、總交易金額

## 本次完成內容

本次接續「大盤走勢」頁，補上圖二需求：

1. 加權指數點位
2. 漲跌點數
3. 漲跌百分比
4. 總交易金額
5. 成交股數
6. 成交筆數
7. 成交資料日期

## 修改檔案

1. `stock-radar-api/server.js`
2. `stock-radar-frontend/app.js`
3. `stock-radar-frontend/style.css`
4. `stock-radar-frontend/service-worker.js`

## 後端 API

沿用原本 API：

```text
GET /market/indices/intraday
```

### 新增回傳欄位

```js
trade_volume          // 成交股數
transaction_count     // 成交筆數
total_trade_amount    // 總交易金額
summary_trade_date    // 成交資料日期
summary_index_point   // 官方收盤指數參考
summary_change_point  // 官方漲跌點數參考
summary_source        // 成交總覽資料來源
summary_error         // 成交總覽讀取錯誤訊息
```

## 資料來源

### 盤中走勢

目前沿用 Yahoo Finance chart API，提供盤中指數折線圖。

### 上市成交總覽

新增 TWSE OpenAPI：

```text
https://openapi.twse.com.tw/v1/exchangeReport/FMTQIK
```

用來補上市市場：

1. TradeVolume：成交股數
2. TradeValue：總交易金額
3. Transaction：成交筆數
4. TAIEX：加權指數
5. Change：漲跌點數

## 前端畫面

「大盤走勢」頁新增：

1. 指數與成交總覽區塊
2. 總交易金額大字卡
3. 成交股數
4. 成交筆數
5. 資料日
6. 成交總覽來源

## 注意事項

1. 上市總交易金額已接 TWSE 官方 OpenAPI。
2. 上櫃總交易金額目前先保留欄位，若後續找到穩定上櫃成交總覽 API，再補到同一個欄位即可。
3. 這次不用新增資料表。
4. PWA 快取版本已從 `stock-radar-pwa-v14` 更新為 `stock-radar-pwa-v15`。

## 測試方式

### 1. 啟動 API

```powershell
cd D:\code\stock-radar\stock-radar-api
npm run dev
```

### 2. 測試 API

```text
http://localhost:3000/market/indices/intraday
```

確認上市資料內有：

```js
total_trade_amount
trade_volume
transaction_count
summary_trade_date
summary_source
```

### 3. 測試前端

打開前端後進入：

```text
大盤走勢
```

確認畫面有出現：

1. 總交易金額
2. 成交股數
3. 成交筆數
4. 資料日

