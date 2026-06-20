# Stock Radar V1.2-5：ETF 官方主檔完整化

## 本次完成

1. 強化 npm run official:etf
   - 原本只從 stocks 表同步 ETF。
   - 現在會優先嘗試官方 ETF 商品資訊來源。
   - 上市 ETF：TWSE ETF 商品資訊。
   - 上櫃 ETF：TPEx ETF 商品資訊與 ETF 商品明細。
   - 官方來源暫時讀不到時，會保留既有資料並使用 stocks fallback，避免每日排程中斷。

2. ETF 主檔欄位補齊
   - ETF 名稱 stock_name
   - 市場別 market_type
   - ETF 類型 fund_type
   - 追蹤指數 underlying_index
   - 基金公司 / 發行人 issuer
   - 掛牌日期 listing_date
   - 資料來源 source
   - 來源網址 source_url

3. 後端 API 強化
   - GET /etf-profiles
   - GET /etf-profiles/stats
   - GET /etf-profiles/:stockCode
   - GET /stock/:stockCode/summary 會繼續帶 ETF 主檔欄位。

4. setup script 強化
   - npm run official:setup 會確認 etf_profiles 必要欄位。

## 覆蓋檔案

stock-radar-api/server.js
stock-radar-api/scripts/syncEtfProfilesFromStocks.js
stock-radar-api/scripts/setupOfficialTables.js
stock-radar-api/sql/v12-official-data-tables.sql

## 建議執行順序

cd D:\code\stock-radar\stock-radar-api
npm run official:setup
npm run official:etf

## 測試 API

https://stock-radar-api-ten.vercel.app/health
https://stock-radar-api-ten.vercel.app/etf-profiles/stats
https://stock-radar-api-ten.vercel.app/etf-profiles/0050
https://stock-radar-api-ten.vercel.app/stock/0050/summary

## 部署指令

git status
git add stock-radar-api/server.js stock-radar-api/scripts/syncEtfProfilesFromStocks.js stock-radar-api/scripts/setupOfficialTables.js stock-radar-api/sql/v12-official-data-tables.sql README-V12-5-ETF官方主檔完整化.txt
git commit -m "完成 V1.2 ETF 官方主檔完整化"
git push
