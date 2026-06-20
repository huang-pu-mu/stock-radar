# V1.2.11 個股 / ETF 行事曆資料匯入

## 本次完成

1. `stock-radar-api/scripts/importStockCalendarEvents.js`
   - 原本只能匯入 CSV。
   - 現在不帶參數時會自動嘗試官方 / 半官方資料來源。
   - 支援上市、上櫃、股票、ETF。
   - 會寫入 `stock_calendar_events`。

2. `stock-radar-api/package.json`
   - `npm run official:events` 改為自動匯入官方 / 半官方行事曆資料。
   - `npm run official:daily` 已加入行事曆匯入。

3. `stock-radar-frontend/app.js`
   - ETF 明細頁現在也會顯示「個股行事曆」區塊。
   - 若 `stock_calendar_events` 有 ETF 配息 / 除息資料，前端會顯示。

4. `stock-radar-frontend/service-worker.js`
   - 快取版本更新為 `stock-radar-pwa-v23`。

## 使用方式

### 自動匯入

```powershell
cd D:\code\stock-radar\stock-radar-api
npm run official:events
```

### CSV 手動匯入

```powershell
npm run official:events -- ./events.csv
```

或：

```powershell
node scripts/importStockCalendarEvents.js --csv ./events.csv
```

CSV 欄位可使用：

```text
股票代號,事件日期,事件類型,標題,說明
0050,2026/07/21,除息,0050 除息,ETF 配息事件
2330,2026/06/10,股東會,台積電股東會,年度股東會
```

## 匯入後檢查

```sql
USE stock_radar;

SELECT COUNT(*) AS total_count
FROM stock_calendar_events;

SELECT *
FROM stock_calendar_events
ORDER BY event_date DESC, stock_code
LIMIT 30;
```

## 注意

1. 官方資料來源若某一天沒有可解析資料，程式會列出來源狀態。
2. CSV 匯入功能仍保留，適合補股東會、法說會、ETF 配息等資料。
3. API `/stock/:stockCode/calendar` 原本已經是資料庫優先，匯入後會優先讀 `stock_calendar_events`。
