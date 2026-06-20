V1.2-8：內外盤 / 五檔報價 / 大盤買賣力道

一、這版完成內容

1. 建立即時行情與五檔資料表

新增資料表：

- realtime_quote_snapshots
- market_order_flow_snapshots

這兩張表是「快照儲存層」，用途是未來接入授權即時/近即時資料源後，可以直接寫入資料庫。

2. 新增 setup 指令

可執行：

npm run official:setup

或單獨執行：

npm run official:microstructure:setup
npm run microstructure:setup

3. 新增 / 強化 API

個股 / ETF 行情：

GET /quote/:stockCode
GET /realtime/:stockCode
GET /stock/:stockCode/quote
GET /stock/:stockCode/realtime

五檔 / 買賣力道：

GET /order-book/:stockCode
GET /stock/:stockCode/order-book
GET /stock/:stockCode/five-level-quotes
GET /stock/:stockCode/buy-sell-force

大盤買賣力道：

GET /market/microstructure
GET /market/order-flow

狀態檢查：

GET /microstructure/status

4. 前端明細頁新增區塊

個股 / ETF 明細頁新增：

- 內外盤 / 五檔報價
- 資料型態
- 快照時間
- 最新價
- 漲跌 / 漲跌幅
- 內盤張數
- 外盤張數
- 五檔委買合計
- 五檔委賣合計
- 五檔表格

如果尚未接入授權即時資料源，前端會顯示正式提示，不會讓明細頁報錯。

二、重要說明

這版不會預設自動抓取即時行情。

原因：即時行情、五檔、委買委賣屬於交易資訊，需要先確認資料來源授權、穩定性與使用條件。

目前 API 會優先讀 realtime_quote_snapshots；如果資料表還沒有快照，會自動改用 daily_prices 最新收盤行情備援。

三、覆蓋後要執行

cd D:\code\stock-radar\stock-radar-api
npm run official:setup
npm run v12:check

四、部署後測試

https://stock-radar-api-ten.vercel.app/health
https://stock-radar-api-ten.vercel.app/microstructure/status
https://stock-radar-api-ten.vercel.app/quote/2330
https://stock-radar-api-ten.vercel.app/order-book/2330
https://stock-radar-api-ten.vercel.app/market/microstructure

health 版本應該看到：

stock-radar-api-v1.2.8

五、Git 指令

git status
git add README-V12-8-內外盤五檔買賣力道.txt stock-radar-api/package.json stock-radar-api/server.js stock-radar-api/scripts/checkV12Status.js stock-radar-api/scripts/setupOfficialTables.js stock-radar-api/scripts/setupMicrostructureTables.js stock-radar-api/sql/v12-official-data-tables.sql stock-radar-frontend/app.js stock-radar-frontend/style.css stock-radar-frontend/service-worker.js
git commit -m "完成 V1.2 內外盤五檔買賣力道基礎功能"
git push

六、下一步建議

V1.2-9：資金流向分析強化

原因：目前市場總覽、法人官方金額與產業資金流向資料都已具備，下一步適合把資金流向頁做成更完整的趨勢分析與圖表。
