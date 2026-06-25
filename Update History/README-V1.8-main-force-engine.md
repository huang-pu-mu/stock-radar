# 雷達之星 V1.8 主力籌碼引擎

## 版本

- API：stock-radar-api-v1.8.0
- PWA：stock-radar-pwa-v64

## 新增功能

- 主力籌碼訊號資料表：main_force_signals
- 主力籌碼摘要資料表：main_force_summaries
- Main Force Score 主力籌碼分數
- 估算主力成本
- 現價與估算主力成本差距
- 大戶比重變化
- 千張大戶比重變化
- 散戶人數變化
- 主力布局 / 鎖碼 / 疑似出貨風險

## 新增 API

- GET /main-force/latest
- GET /main-force/top
- GET /v18/status
- GET /v18/acceptance

## 新增指令

```bash
npm run main-force:setup
npm run main-force:generate
npm run main-force:daily
npm run v18:check
npm run v18:test -- --api=http://localhost:3000
```

## 驗收方式

1. 套用 Patch
2. 重新啟動 API
3. 執行 `npm run v18:test -- --api=http://localhost:3000`
4. 將 `logs/v18-acceptance-YYYYMMDD-HHMMSS.log` 回傳檢查
