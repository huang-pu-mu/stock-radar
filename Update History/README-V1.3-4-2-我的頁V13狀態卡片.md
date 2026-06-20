# V1.3-4-2：我的頁 V1.3 狀態卡片

## 完成內容

新增前端「我的」頁 V1.3 系統狀態卡片，讓使用者可以直接在 APP 內檢查 V1.3 功能是否正常。

## 修改檔案

```text
stock-radar-api/server.js
stock-radar-frontend/app.js
stock-radar-frontend/style.css
stock-radar-frontend/service-worker.js
Update History/README-V1.3-4-2-我的頁V13狀態卡片.md
```

## API 版本

```text
stock-radar-api-v1.3.4.2
```

## PWA 快取版本

```text
stock-radar-pwa-v42
```

## 前端新增功能

```text
我的頁顯示 V1.3 整體狀態
我的頁顯示 API 版本
我的頁顯示 PWA 預期版本
我的頁顯示資料庫名稱
我的頁顯示最新行情日期
我的頁顯示 MariaDB / 核心行情 / 自選股提醒 / 策略追蹤 / 策略回測檢查結果
我的頁顯示自選股提醒筆數
我的頁顯示策略追蹤筆數
我的頁顯示最新回測 Run
我的頁顯示各策略 5 日平均與勝率
新增「重新檢查 V1.3」按鈕
新增快速前往策略回測 / 提醒中心 / 策略追蹤按鈕
```

## 使用 API

```http
GET /v13/status
```

## 驗收項目

```text
我的頁是否出現 V1.3 系統狀態卡片
是否顯示 API 版本 stock-radar-api-v1.3.4.2
是否顯示 PWA 預期版本 stock-radar-pwa-v42
是否顯示 V1.3 狀態正常 / 需確認 / 異常
是否顯示自選股提醒資料
是否顯示策略追蹤資料
是否顯示策略回測資料
是否顯示各策略回測統計
重新檢查 V1.3 是否可用
策略回測 / 提醒中心 / 策略追蹤按鈕是否可切換頁面
手機 / iPad 是否看到新版畫面
```
