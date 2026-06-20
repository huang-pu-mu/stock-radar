# V1.3-1-1 自選股提醒資料表與提醒分析腳本

## 本次完成內容

1. 新增提醒規則表
   - `watchlist_alert_rules`
   - 每位使用者、每檔自選股一筆提醒設定

2. 新增提醒結果表
   - `watchlist_alerts`
   - 每天產生符合條件的提醒
   - 支援已讀 / 未讀

3. 新增資料表建立指令

```bash
cd D:\code\stock-radar\stock-radar-api
npm run alerts:setup
```

4. 新增提醒產生指令

```bash
cd D:\code\stock-radar\stock-radar-api
npm run alerts:generate
```

也可以指定日期：

```bash
npm run alerts:generate -- 2026-06-18
```

5. `npm run daily` 已加入第 6 步
   - 每日資料匯入完成後
   - 自動執行自選股提醒分析
   - 如果提醒分析失敗，不會中斷原本每日資料流程

---

## 新增檔案

```text
stock-radar-api/sql/watchlist-alerts.sql
stock-radar-api/scripts/setupWatchlistAlerts.js
stock-radar-api/scripts/generateWatchlistAlerts.js
README-V1.3-1-1-自選股提醒.md
```

---

## 修改檔案

```text
stock-radar-api/package.json
stock-radar-api/scripts/dailyTwse.js
```

---

## 目前支援的提醒條件

1. 外資連買
   - 預設：連買 3 天
   - alert_type：`foreign_buy_streak`

2. 投信連買
   - 預設：連買 3 天
   - alert_type：`investment_trust_buy_streak`

3. 主力 / 大戶籌碼增加
   - 預設：400 張以上大戶持股比例增加 0.3 個百分點
   - alert_type：`major_holder_increase`

4. 成交量放大
   - 預設：大於近 20 日或可用短期均量 1.5 倍
   - alert_type：`volume_spike`

5. 籌碼分數達標
   - 預設：籌碼分數 >= 80
   - alert_type：`chip_score_threshold`

6. 個股 / ETF 行事曆事件
   - 預設：14 天內事件
   - alert_type：`calendar_event`

---

## 建議驗收流程

### 1. 建立資料表

```bash
cd D:\code\stock-radar\stock-radar-api
npm run alerts:setup
```

正常會看到：

```text
開始建立 V1.3 自選股提醒資料表
建立完成
資料表：watchlist_alert_rules
資料表：watchlist_alerts
```

---

### 2. 產生提醒

```bash
npm run alerts:generate
```

正常會看到類似：

```text
開始產生 V1.3 自選股提醒
最近可用交易日：YYYY-MM-DD
新增預設提醒規則：N 筆
啟用提醒規則：N 筆
提醒產生完成
本次符合條件提醒：N 筆
```

---

### 3. 用 HeidiSQL 檢查提醒結果

```sql
SELECT *
FROM watchlist_alerts
ORDER BY created_at DESC
LIMIT 20;
```

---

### 4. 檢查提醒規則

```sql
SELECT *
FROM watchlist_alert_rules
ORDER BY user_id, stock_code;
```

---

## 注意事項

1. 目前是 V1.3 第一階段，只有「產生提醒資料」，還沒有前端提醒中心。
2. 下一步建議做 V1.3-1-2：提醒中心 API。
3. `alerts:generate` 會自動幫既有自選股建立預設提醒規則。
4. 重複執行同一天不會重複新增同一筆提醒，會更新內容但保留已讀狀態。
5. 休市日執行時，會自動找 `chip_scores` 裡最近可用交易日。
