# 雷達之星 V1.5.0.1 TAIFEX 匯入修正版

## 修正內容

- 修正 TAIFEX OpenAPI 預設端點：
  - 舊：`https://openapi.taifex.com.tw/v1/DailyMarket`
  - 新：`https://openapi.taifex.com.tw/v1/DailyMarketReportFut`
- 加入來源網址 fallback：
  - `TAIFEX_DAILY_MARKET_URL` 環境變數
  - `DailyMarketReportFut`
  - 舊版 `DailyMarket`
- 回傳 HTML 時改成清楚錯誤，不再讓 Windows Node 24 發生 UV_HANDLE_CLOSING assertion crash。
- DB pool 改成資料來源讀取成功後才載入，避免外部 OpenAPI 失敗時還初始化資料庫連線。
- 匯入成功時 log 顯示實際使用來源。

## 套用後建議驗收

```powershell
cd D:\code\stock-radar\stock-radar-api
npm run market-risk:import
npm run market-risk:score
npm run v15:test -- --api=http://localhost:3000
```

如果 API 動態檢查仍為 fetch failed，請確認另一個 PowerShell 已執行：

```powershell
cd D:\code\stock-radar\stock-radar-api
npm run start
```
