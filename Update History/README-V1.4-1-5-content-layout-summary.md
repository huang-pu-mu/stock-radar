# V1.4-1-5 右側內容區標題、篩選列、清單 / 卡片 / 統計重整

## 版本

- API：stock-radar-api-v1.4.1.9
- PWA Cache：stock-radar-pwa-v47

## 本次目標

整理桌機 / 平板右側內容區，讓畫面更接近正式後台 / APP 操作介面。

## 完成內容

1. 頁面標題區強化
   - 新增頁面狀態摘要列。
   - 顯示目前分類與目前市場。

2. 篩選列重整
   - 新增「篩選列」區塊標題。
   - 依不同頁面切換篩選說明。
   - 原本市場切換、個股搜尋、手機次功能列、使用說明統一收進篩選區塊。

3. 統計摘要區
   - 新增 `contentSummaryBar`。
   - 清單載入後顯示市場、筆數、資料日、第一筆、平均分數等摘要。
   - 個股查詢、策略選股、策略追蹤、策略回測、提醒中心、我的頁都有對應摘要。

4. 清單標題區
   - 新增 `resultHeader`。
   - 下方股票清單 / 卡片 / 統計前，先顯示目前內容標題、說明、筆數與標籤。

5. 響應式
   - 桌機 / 平板：右側內容區維持寬版資訊密度。
   - 手機：摘要卡片自動改成 2 欄或 1 欄，避免擠壓。

## 修改檔案

- stock-radar-frontend/index.html
- stock-radar-frontend/style.css
- stock-radar-frontend/app.js
- stock-radar-frontend/service-worker.js
- stock-radar-api/server.js
- stock-radar-api/scripts/checkV13.js

## 驗收指令

```bash
cd D:\code\stock-radar
node --check stock-radar-frontend\app.js
node --check stock-radar-api\server.js
cd stock-radar-api
npm run v14:check
```
