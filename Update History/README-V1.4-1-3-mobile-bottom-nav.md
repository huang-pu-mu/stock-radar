# V1.4-1-3 手機底部主導航與頁內次功能切換

## 本次版本

- API 版本：`stock-radar-api-v1.4.1.8`
- PWA 快取版本：`stock-radar-pwa-v46`

## 本次背景

本次附件檢查時，程式碼仍停在：

- API：`stock-radar-api-v1.4.1.6`
- PWA：`stock-radar-pwa-v44`

因此本次一併補上：

1. `V1.4-1-2` 桌機 / 平板左側功能列 + 右側內容區
2. `V1.4-1-3` 手機直向底部主導航 + 頁內次功能切換

## 已完成內容

### 1. 桌機 / 平板

- 改成左側固定功能列 + 右側內容區。
- 左側功能列依功能分類：
  - 市場雷達
  - 個股與自選
  - 策略中心
  - 系統
- 左側功能列支援捲動。
- 目前所在功能會高亮。
- 每個功能加入小圖示。

### 2. 手機直向

- 新增底部主導航：
  - 雷達
  - 個股
  - 策略
  - 提醒
  - 我的
- 新增頁內次功能切換：
  - 雷達：今日、外資、連買、投信、同步、產業、主力
  - 個股：查詢、自選
  - 策略：選股、追蹤、回測
  - 提醒：提醒
  - 我的：我的
- 手機版保留右下角回到頂部按鈕，並避免與底部主導航重疊。

### 3. 提醒徽章

- 因為提醒按鈕現在會出現在左側功能列、手機頁內次功能與手機底部主導航，所以提醒未讀徽章改成多位置同步顯示。

## 修改檔案

- `stock-radar-frontend/index.html`
- `stock-radar-frontend/style.css`
- `stock-radar-frontend/app.js`
- `stock-radar-frontend/service-worker.js`
- `stock-radar-api/server.js`
- `stock-radar-api/scripts/checkV13.js`

## 驗收指令

```bash
cd D:\code\stock-radar

node --check stock-radar-frontend\app.js
node --check stock-radar-api\server.js

cd stock-radar-api
npm run v14:check
```

## 驗收結果

- `node --check stock-radar-frontend/app.js`：通過
- `node --check stock-radar-api/server.js`：通過
- `npm run v14:check`：通過，60 / 60
