# V1.2 第一項：上市 / 上櫃指數即時走勢修改說明

## 這次完成內容

1. 新增前端頁籤：大盤走勢
2. 新增 API：GET /market/indices/intraday
3. 顯示上市加權指數、上櫃指數
4. 顯示目前指數、漲跌點數、漲跌幅、開高低、昨收
5. 顯示盤中即時折線圖
6. 成交量柱狀圖已預留，資料來源有提供 volume 時會顯示
7. service worker 快取版本由 v13 升級到 v14，避免前端更新後仍看到舊畫面

## 修改檔案

1. stock-radar-api/server.js
2. stock-radar-frontend/index.html
3. stock-radar-frontend/app.js
4. stock-radar-frontend/style.css
5. stock-radar-frontend/service-worker.js

## 測試方式

### API 本機測試

```powershell
cd D:\code\stock-radar\stock-radar-api
npm run dev
```

瀏覽器開啟：

```text
http://localhost:3000/market/indices/intraday
```

正常會看到：

```json
{
  "success": true,
  "message": "大盤指數即時走勢讀取完成",
  "data": {
    "indices": []
  }
}
```

indices 裡面會包含加權指數與上櫃指數資料。

### 前端測試

```powershell
cd D:\code\stock-radar\stock-radar-frontend
```

用 VS Code Live Server 或直接用目前部署流程開啟前端，點擊：

```text
大盤走勢
```

## 注意

1. 這一版先完成圖一需求。
2. 1-1「加權指數、漲跌數、總交易金額」會在下一步繼續補完整。
3. 目前即時資料來源先走 Yahoo Finance chart，由後端 API 讀取，前端不直接連外部網站。
4. 如果部署後還是看不到新頁籤，請重新整理或清除 PWA 快取，因為手機 PWA 可能會保留舊版靜態檔。
