# V1.4-1-2 桌機 / 平板左側功能列 + 右側內容區

## 完成日期

2026-06-21

## 版本

- API：stock-radar-api-v1.4.1.7
- PWA Cache：stock-radar-pwa-v45

## 本次完成內容

1. 將原本上方功能按鈕列改為桌機 / 平板左側功能列。
2. 新增右側內容區 `.app-main`，保留頁面標題、說明、重新整理、篩選列與資料清單。
3. 左側功能列完成分類：
   - 市場雷達
   - 個股與自選
   - 策略中心
   - 系統
4. 左側功能列支援可捲動，長螢幕與小螢幕都不會被功能按鈕撐爆。
5. 目前所在功能維持高亮顯示，沿用原本 `tab-btn.active` 切換邏輯。
6. 每個功能按鈕新增簡易小圖示，提升辨識度。
7. 手機版先保留水平分類捲動，正式底部主導航留到 V1.4-1-3 開發。
8. 更新 `npm run v14:check` 檢查項目，加入 V1.4 左側版面驗收標記。

## 修改檔案

- stock-radar-frontend/index.html
- stock-radar-frontend/style.css
- stock-radar-frontend/service-worker.js
- stock-radar-api/server.js
- stock-radar-api/scripts/checkV13.js
- Update History/README-V1.4-1-2-desktop-sidebar-layout.md

## 驗收重點

1. 桌機寬版畫面左邊出現功能列，右邊出現內容區。
2. 左側功能列可上下捲動。
3. 點不同功能時，左側目前功能會高亮。
4. 右側上方仍顯示頁面標題、頁面說明、篩選列與說明卡。
5. 股票清單、策略頁、提醒頁、我的頁都仍在右側內容區顯示。
6. 手機版畫面不破版，功能分類可以左右滑動。

## 驗收指令

```bash
cd D:\code\stock-radar

node --check stock-radar-frontend\app.js
node --check stock-radar-api\server.js

cd stock-radar-api
npm run v14:check
```
