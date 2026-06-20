股票 PWA V1.2-4：ETF / 個股行事曆前端顯示

本包只包含本次需要覆蓋的 4 個檔案，不包含 .env / .env.local / node_modules。

覆蓋位置：
1. stock-radar-api/server.js
2. stock-radar-frontend/app.js
3. stock-radar-frontend/style.css
4. stock-radar-frontend/service-worker.js

完成內容：
1. API 新增 GET /calendar-events/:stockCode
2. API 新增 GET /etf-profiles/:stockCode
3. /stock/:stockCode/summary 補 security_type 與 ETF 主檔欄位
4. 前端股票明細頁新增「個股 / ETF 行事曆」區塊
5. ETF 明細頁新增「ETF 基本資料」區塊
6. 無行事曆資料時顯示「目前尚無近期行事曆事件。」
7. service-worker 快取版本更新為 stock-radar-pwa-v24

建議測試網址：
1. /calendar-events/2330
2. /calendar-events/0050
3. /etf-profiles/0050
4. 前端搜尋 2330 或 0050，點「看明細」確認行事曆區塊。

部署後建議：
1. stock-radar-api：npm run start 或推送 Vercel 後測 API。
2. stock-radar-frontend：推送 Vercel 後手機/瀏覽器重新整理；如仍看到舊畫面，清除 PWA 快取或重新開啟 APP。
