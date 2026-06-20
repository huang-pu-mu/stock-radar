# V1.3-1-4：提醒規則設定頁面

## 完成內容

本次新增前端「提醒設定」功能，讓使用者可以在 APP 裡直接調整每一檔自選股的提醒條件。

## 修改檔案

```text
stock-radar-frontend/app.js
stock-radar-frontend/style.css
stock-radar-frontend/service-worker.js
```

## 新增功能

```text
提醒中心新增「提醒設定」按鈕
提醒設定頁可列出所有自選股提醒規則
每檔股票可獨立啟用 / 停用提醒
可調整外資連買天數
可調整投信連買天數
可調整大戶比例增加門檻
可調整成交量放大倍數
可調整籌碼分數門檻
可調整行事曆提前提醒天數
可儲存單檔股票提醒規則
提醒篩選補上「已讀」
```

## 使用的 API

```text
GET /watchlist/rules
POST /watchlist/rules
GET /watchlist/alerts
POST /watchlist/alerts/:alertId/read
POST /watchlist/alerts/read-all
```

## PWA 快取

```text
stock-radar-pwa-v31
```

## 驗收項目

```text
提醒中心可以看到「提醒設定」按鈕
點提醒設定後可看到每一檔自選股的設定卡片
可以修改門檻數字
可以勾選啟用 / 停用條件
按儲存設定後成功寫入
重新整理後設定仍保留
提醒中心篩選可看到未讀 / 已讀 / 全部 / 高重要
```
