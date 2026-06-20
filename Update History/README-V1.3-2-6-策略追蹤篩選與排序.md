# V1.3-2-6：策略追蹤篩選與排序

## 本版目標

強化策略追蹤頁，讓使用者可以用篩選與排序快速檢查追蹤股票。

## 後端強化

### 強化 API

```http
GET /strategy-watchlist
GET /strategy-watchlist/performance
GET /strategy-watchlist/rankings
```

新增支援參數：

```text
strategy：依來源策略篩選
status：依表現狀態篩選，可用 strong / neutral / weak / pending
search：搜尋股票代號、股票名稱、策略名稱、產業、觸發原因
sort：排序方式
```

### sort 可用值

```text
created_desc       加入時間新到舊
created_asc        加入時間舊到新
current_desc       目前報酬高到低
current_asc        目前報酬低到高
1d_desc            1 日報酬高到低
1d_asc             1 日報酬低到高
3d_desc            3 日報酬高到低
3d_asc             3 日報酬低到高
5d_desc            5 日報酬高到低
5d_asc             5 日報酬低到高
source_score_desc  加入時分數高到低
source_score_asc   加入時分數低到高
stock_code_asc     股票代號小到大
stock_code_desc    股票代號大到小
```

## 前端新增功能

策略追蹤頁新增：

```text
搜尋股票 / 產業
依來源策略篩選
依表現狀態篩選
依報酬 / 加入時間 / 股票代號排序
清除篩選
篩選結果摘要
```

表現狀態：

```text
轉強
觀察中
轉弱
等待資料
```

## PWA 快取

```text
stock-radar-pwa-v38
```

## 修改檔案

```text
stock-radar-api/server.js
stock-radar-frontend/app.js
stock-radar-frontend/style.css
stock-radar-frontend/service-worker.js
```
