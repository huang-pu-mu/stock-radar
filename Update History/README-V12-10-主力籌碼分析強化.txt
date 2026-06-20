# V1.2-10 主力籌碼分析強化

## 一、完成內容

本次延續既有 TDCC 集保大戶資料，強化主力籌碼分析，不重建資料表、不更動既有匯入流程。

完成項目：

1. 後端 API 版本更新為 stock-radar-api-v1.2.10
2. PWA 快取版本更新為 stock-radar-pwa-v28
3. 新增個股主力籌碼分析 API
4. 強化主力籌碼排行榜排序與回傳欄位
5. 前端主力籌碼頁新增集中度分數、4 週 / 12 週趨勢
6. 個股明細頁新增主力趨勢總覽與大戶比重趨勢圖
7. V1.2 檢查機制納入 major_holder_stats 與主力籌碼匯入指令

---

## 二、新增 API

### 1. 個股主力籌碼分析

```text
GET /major-holders/:stockCode/analysis?limit=24
```

範例：

```text
https://stock-radar-api-ten.vercel.app/major-holders/2330/analysis?limit=24
```

回傳內容包含：

```text
latest  最新一筆大戶資料
trend   4週 / 12週趨勢統計
history 歷史週資料
```

主要新增欄位：

```text
concentration_score
major_holder_trend_status
trend_direction
trend_weeks_up
trend_weeks_down
large_holder_ratio_change_4w
large_holder_ratio_change_12w
small_holder_ratio_change_4w
small_holder_ratio_change_12w
large_holder_share_change_lots_4w
large_holder_share_change_lots_12w
```

---

## 三、強化 API

### 主力籌碼排行榜

```text
GET /radar/major-holder?sort=trend&limit=100
```

新增排序模式：

```text
sort=trend           依集中度與趨勢排序，預設
sort=concentration   依集中度分數排序
sort=distribution    依大戶減碼 / 籌碼轉弱排序
```

範例：

```text
https://stock-radar-api-ten.vercel.app/radar/major-holder?sort=trend&limit=30
https://stock-radar-api-ten.vercel.app/radar/major-holder?sort=concentration&limit=30
https://stock-radar-api-ten.vercel.app/radar/major-holder?sort=distribution&limit=30
```

---

## 四、前端顯示

### 主力籌碼頁

新增顯示：

```text
集中度分數
4週大戶比重變化
12週大戶比重變化
4週大戶張數變化
散戶比重變化
連續增加週數
```

### 個股明細頁

新增顯示：

```text
主力趨勢總覽
籌碼集中度進度條
4週 / 12週趨勢統計
大戶比重趨勢圖
大戶週變化列表
```

---

## 五、覆蓋檔案

```text
stock-radar-api/server.js
stock-radar-api/scripts/checkV12Status.js
stock-radar-frontend/app.js
stock-radar-frontend/style.css
stock-radar-frontend/service-worker.js
README-V12-10-主力籌碼分析強化.txt
```

---

## 六、覆蓋後測試

先確認資料表與資料：

```bash
cd D:\code\stock-radar\stock-radar-api
npm run major-holders:setup
npm run major-holders:import
npm run v12:check
```

部署後測試：

```text
https://stock-radar-api-ten.vercel.app/health
https://stock-radar-api-ten.vercel.app/major-holders/status
https://stock-radar-api-ten.vercel.app/radar/major-holder?sort=trend&limit=30
https://stock-radar-api-ten.vercel.app/major-holders/2330/analysis?limit=24
```

/health 正常應看到：

```text
stock-radar-api-v1.2.10
```

---

## 七、注意事項

TDCC 集保大戶資料通常是週資料，不是每日即時資料。

如果畫面顯示資料不足，代表目前 major_holder_stats 歷史週數不夠；請先多匯入幾期 TDCC 資料後，4週與12週趨勢才會更完整。
