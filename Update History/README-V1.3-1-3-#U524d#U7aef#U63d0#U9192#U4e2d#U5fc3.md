# V1.3-1-3：前端提醒中心頁面

## 本次目標

把 V1.3-1-2 已完成的提醒中心 API 接到前端，讓 APP 可以直接查看自選股提醒。

## 修改檔案

```text
stock-radar-frontend/index.html
stock-radar-frontend/app.js
stock-radar-frontend/style.css
stock-radar-frontend/service-worker.js
```

## 新增前端功能

```text
提醒頁籤
未讀提醒數 badge
提醒中心總覽卡片
未讀 / 全部 / 高重要 篩選
提醒卡片列表
單筆標記已讀
全部標記已讀
看股票明細按鈕
未登入提示
空提醒提示
我的頁增加提醒中心入口
```

## 對應 API

```text
GET /watchlist/alerts
GET /watchlist/alerts/unread-count
POST /watchlist/alerts/:alertId/read
POST /watchlist/alerts/read-all
```

## 權限

提醒中心需要 Google 登入。

如果尚未登入，會顯示登入提示。

## PWA 快取

```text
stock-radar-pwa-v30
```

本次已更新 service worker 快取版本，避免手機或 iPad 持續看到舊版畫面。

## 驗收建議

1. 前端登入 Google。
2. 點「提醒」頁籤。
3. 應看到提醒中心總覽與提醒卡片。
4. 點「標記已讀」。
5. 未讀數應下降。
6. 點「全部已讀」。
7. 未讀 badge 應消失。
8. 點提醒卡片上的「看股票」。
9. 應打開股票明細。

## 注意

這版先做提醒中心查看與已讀操作。

提醒規則設定頁面可在下一步 V1.3-1-4 製作。
