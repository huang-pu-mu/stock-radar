Stock Radar V1.2-6：股東會 / 法說會 / 停止過戶資料來源修正

一、這次修正目的

原本 importStockCalendarEvents.js 仍保留幾個 MOPS 候選 CSV：

- t108sb31_L.csv
- t108sb31_O.csv
- t100sb02_L.csv
- t100sb02_O.csv

這些來源容易出現 HTTP 404 或回傳 MOPS 維護 / 安全性頁面，導致「股東會 / 法說會」資料無法穩定匯入。

本版改成：

1. 除權息與停止過戶資料：保留 TWSE / TPEx 除權息來源。
2. 股東會資料：改用 TWSE OpenAPI 上市公司股利分派情形，以及 MOPS t187ap45_L / t187ap45_O 備援來源。
3. 法說會資料：改用 MOPS 法人說明會查詢頁 ajax_t100sb02_1 備援解析。
4. 若可選來源失敗，不會中斷每日排程。
5. 若本次行事曆沒有可匯入事件，但主要來源沒有失敗，也不會讓 official:daily 失敗。

二、主要修改檔案

- stock-radar-api/scripts/importStockCalendarEvents.js
- stock-radar-api/server.js

三、新增 / 強化的事件類型

- 除權息
- 除息
- 除權
- 配息
- 股東會
- 法說會
- 股務事件（停止過戶等）
- 董事會股利分派

四、新增 API

GET /calendar-events/stats

用途：快速確認 stock_calendar_events 目前總筆數、股票數、各事件類型筆數、最近更新時間。

五、API 版本

stock-radar-api-v1.2.6

六、覆蓋後建議執行

cd D:\code\stock-radar\stock-radar-api
npm run official:events

七、部署後建議測試

https://stock-radar-api-ten.vercel.app/health
https://stock-radar-api-ten.vercel.app/calendar-events/stats
https://stock-radar-api-ten.vercel.app/calendar-events/2330
https://stock-radar-api-ten.vercel.app/calendar-events/0050

八、注意事項

MOPS 法說會查詢不是純 CSV / OpenAPI，而是網站查詢頁的 HTML 表格，因此本版設計為 optional 備援來源。
如果 MOPS 改版或封鎖，匯入腳本會略過該來源，不會中斷官方每日排程。

