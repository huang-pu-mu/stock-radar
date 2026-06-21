# V1.4-1-1 / V1.4-1-6 UI 優化說明

## 一、版本

- API 版本：stock-radar-api-v1.4.1.6
- PWA 快取版本：stock-radar-pwa-v44
- 開發日期：2026-06-21

## 二、本次完成項目

### V1.4-1-1：右下角回到頂部浮動按鈕

- 新增右下角浮動按鈕：`#backToTopBtn`
- 頁面往下捲動超過 520px 後顯示
- 點擊後平滑捲回頁面頂部
- 支援手機安全區域 `env(safe-area-inset-bottom)`
- 手機版按鈕自動縮小，只顯示箭頭，避免遮住後續底部主導航

### V1.4-1-6：策略回測搜尋結果體驗優化

- 套用策略回測搜尋後，自動捲到「回測結果清單」
- 搜尋後顯示：`目前搜尋：2330`
- 搜尋後顯示：`共找到 X 筆回測訊號`
- 搜尋後若有結果，優先顯示搜尋結果清單
- 搜尋後若無結果，顯示：`2330 在本次回測沒有策略訊號`
- 無資料時提示：`請改用「個股查詢」查看股票目前資料`
- 排行榜加註：`排行榜不受搜尋條件影響`
- API `/strategy-backtests/results` 新增 `total_count`，讓前端顯示完整搜尋筆數，不只顯示目前 limit 取回筆數

## 三、修改檔案

- `stock-radar-frontend/index.html`
- `stock-radar-frontend/style.css`
- `stock-radar-frontend/app.js`
- `stock-radar-frontend/service-worker.js`
- `stock-radar-api/server.js`
- `stock-radar-api/package.json`
- `stock-radar-api/scripts/checkV13.js`

## 四、驗收方式

### 1. 前端語法檢查

```bash
cd D:\code\stock-radar
node --check stock-radar-frontend\app.js
```

### 2. API 語法檢查

```bash
cd D:\code\stock-radar
node --check stock-radar-api\server.js
```

### 3. V1.4 檢查

```bash
cd D:\code\stock-radar\stock-radar-api
npm run v14:check
```

### 4. 手動畫面驗收

1. 開啟 PWA。
2. 往下滑超過一段距離。
3. 確認右下角出現 TOP / ↑ 按鈕。
4. 點擊後確認畫面回到最上方。
5. 進入「策略回測」。
6. 搜尋 2330。
7. 確認畫面自動捲到「回測結果清單」。
8. 確認出現「目前搜尋：2330」。
9. 確認出現「共找到 X 筆回測訊號」。
10. 若無資料，確認出現「2330 在本次回測沒有策略訊號」與「請改用『個股查詢』查看股票目前資料」。
11. 確認排行榜區塊顯示「排行榜不受搜尋條件影響」。

## 五、部署提醒

- 本次有修改 `service-worker.js`，PWA 快取版本已升級到 `stock-radar-pwa-v44`。
- 部署後若手機仍看到舊畫面，請重新整理一次，或移除 PWA 後重新安裝。
