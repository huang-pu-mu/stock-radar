# V1.4-8：V1.4 系統狀態 / 驗收檢查收尾

## 版本

- API：stock-radar-api-v1.4.8.0
- PWA Cache：stock-radar-pwa-v54

## 本次完成

1. 新增 `GET /v14/status`。
2. 新增 `GET /v14/acceptance`。
3. 我的頁系統狀態卡片改為 V1.4 狀態檢查。
4. V1.4 狀態卡片新增功能完成度、延後項目、下一步驗收清單。
5. `npm run v14:check` 更新為 V1.4-8 靜態驗收。
6. Email / Telegram 依需求維持延後，不列入本輪驗收。

## V1.4 狀態檢查內容

- MariaDB 連線
- API / PWA 版本
- V1.4 必要資料表
- 核心行情 / 法人 / 籌碼資料
- 策略參數最佳化
- 回測條件調整
- LINE 通知外送
- 每日策略報告
- 策略勝率趨勢
- 個股策略歷史紀錄

## 驗收指令

```bash
cd D:\code\stock-radar

node --check stock-radar-frontend\app.js
node --check stock-radar-api\server.js
node --check stock-radar-api\scripts\checkV13.js

cd stock-radar-api
npm run v14:check
```

## 驗收 API

```http
GET /health
GET /v14/status
GET /v14/acceptance
```
