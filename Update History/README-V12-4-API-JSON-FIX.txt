# V1.2-4 API 非 JSON 錯誤修正版

## 修正原因
前端出現：
API 回傳不是 JSON，Unexpected token '<', "<!DOCTYPE "...

代表前端打到的網址回傳 HTML，不是 API JSON。
常見原因：
1. 前端 API_BASE_URL 指到前端站，而不是 API 站。
2. API 專案尚未重新部署，還沒有 /calendar-events/:stockCode 或 /etf-profiles/:stockCode。
3. Vercel API 部署失敗，回傳 Vercel HTML 錯誤頁。
4. localStorage 裡殘留舊的 STOCK_RADAR_API_BASE_URL。

## 本次修正檔案
stock-radar-api/server.js
stock-radar-frontend/app.js
stock-radar-frontend/service-worker.js
stock-radar-frontend/style.css

## 修正內容
1. server.js
- / 回傳版本改為 stock-radar-api-v1.2.4
- 新增 /health 健康檢查路由
- 新增 JSON 版 404 handler，避免 Express 回傳 HTML 404
- 新增 JSON 版 500 handler

2. app.js
- fetchJson 改為先讀 text，再 JSON.parse
- 非 JSON 時會顯示 HTTP 狀態、實際 URL、回傳開頭
- 新增 window.resetStockRadarApiUrl()，可清除 localStorage 裡的 API URL 覆蓋值

3. service-worker.js
- 快取版本更新為 stock-radar-pwa-v25

## 覆蓋後測試
1. 先部署 API，再部署前端。
2. 打開：
https://stock-radar-api-ten.vercel.app/health

應看到 JSON：
{
  "success": true,
  "message": "API health check OK",
  "version": "stock-radar-api-v1.2.4"
}

3. 打開：
https://stock-radar-api-ten.vercel.app/calendar-events/2330

應看到 JSON，不應該看到 <!DOCTYPE html>。

4. 如果前端仍顯示打到錯誤 URL，請在瀏覽器 Console 執行：
resetStockRadarApiUrl()

