# V1.4.8.1 桌機版左側功能列版面修正

## 修改目的

修正電腦版在大螢幕寬度下，功能列沒有呈現為左側欄位，而是像上方功能按鈕排列的問題。

## 修正內容

1. 桌機 / 筆電 / 平板橫向，強制使用左側功能列 + 右側內容區。
2. 寬度大於 761px 時，`.app-main-layout` 強制使用 grid。
3. 寬度大於 1280px 時，左側功能列固定為 300px，右側內容區自動撐開。
4. 桌機版強制隱藏手機底部主導航與手機頁內次功能列。
5. 左側功能列按鈕強制直向排列，避免被舊版 `.tab-btn` 或上方選單樣式覆蓋。
6. 更新 API 版本為 `stock-radar-api-v1.4.8.1`。
7. 更新 PWA 快取版本為 `stock-radar-pwa-v55`。

## 驗收重點

| 裝置 | 預期結果 |
|---|---|
| 電腦 1920px | 左側功能列 + 右側內容區 |
| 筆電 1366px | 左側功能列 + 右側內容區 |
| iPad 橫向 | 左側功能列 + 右側內容區 |
| 手機直向 | 底部主導航 |
| 手機橫向 | 不破版 |

## 本次修改檔案

1. `stock-radar-frontend/style.css`
2. `stock-radar-frontend/service-worker.js`
3. `stock-radar-api/server.js`
4. `stock-radar-api/scripts/checkV13.js`
