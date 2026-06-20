# Stock Radar V1.2-11：完整收尾檢查與前端細修

## 本次目的

這次不新增大型資料來源，主要做 V1.2 收尾：

1. 統一 API / PWA 版本號。
2. 新增後端 V1.2 狀態檢查 API。
3. 強化 npm run v12:check，檢查前端、後端、PWA 快取、主要路由與資料表。
4. 在前端「我的」頁新增系統狀態卡，方便直接看目前 API、資料表、功能完成狀態。
5. 提供 API 網址快取清除按鈕，降低前端打到錯誤 API_BASE_URL 的機率。

## API 版本

stock-radar-api-v1.2.11

## PWA 快取版本

stock-radar-pwa-v29

## 新增 API

GET /v12/status

用途：

- 顯示 API 版本
- 顯示 PWA 版本
- 顯示資料庫連線資訊
- 檢查 V1.2 主要資料表是否存在
- 顯示各資料表筆數與最新日期
- 顯示 V1.2-4 到 V1.2-11 功能狀態
- 回傳主要 API 路由清單

測試網址：

https://stock-radar-api-ten.vercel.app/v12/status

## 強化指令

npm run v12:check

新增檢查：

- API 版本是否為 stock-radar-api-v1.2.11
- service-worker 是否為 stock-radar-pwa-v29 以上
- /v12/status 是否存在
- /market/flow/summary 是否存在
- /microstructure/status 是否存在
- /major-holders/:stockCode/analysis 是否存在
- /calendar-events/:stockCode 是否存在
- /etf-profiles/:stockCode 是否存在
- 前端是否有資金流向頁籤
- 前端是否有主力籌碼頁籤
- 前端是否有系統狀態卡片
- 前端是否有 API 網址快取清除功能

## 前端新增位置

前端「我的」頁會新增「系統狀態」卡片。

可看到：

- 前端版本
- API 版本
- API_BASE_URL
- 檢查時間
- 資料表正常數量
- 警告數
- V1.2 功能狀態
- V1.2 資料表狀態

## 覆蓋後建議測試

cd D:\code\stock-radar\stock-radar-api
npm run v12:check

部署後測：

https://stock-radar-api-ten.vercel.app/health
https://stock-radar-api-ten.vercel.app/v12/status

前端測試：

1. 打開前端 PWA。
2. 進入「我的」。
3. 檢查是否出現「系統狀態」。
4. 按「重新檢查」。
5. 確認 API 版本顯示 stock-radar-api-v1.2.11。

## 注意事項

realtime_quote_snapshots 與 market_order_flow_snapshots 目前可能是 0 筆，這是正常的。
V1.2-8 目前是基礎框架，尚未正式接入即時授權資料源。
