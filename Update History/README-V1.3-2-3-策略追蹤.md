# V1.3-2-3 策略收藏與策略追蹤

## 本版目標

把 V1.3-2 的「策略選股」結果變成可以持續觀察的清單。

使用者可以在「策略選股」頁面，針對某一檔股票按「策略追蹤」，系統會記錄：

- 股票代號
- 股票名稱
- 來源策略
- 加入時策略分數
- 加入時排序
- 來源資料日
- 觸發原因
- 加入時間

之後可到「策略追蹤」頁籤查看後續表現。

---

## 新增資料表

```text
strategy_watchlists
```

建立指令：

```bash
cd D:\code\stock-radar\stock-radar-api
npm run strategy-watchlists:setup
```

---

## 新增 API

### 查詢策略追蹤

```http
GET /strategy-watchlist
```

可選參數：

```text
strategy
stock_code
active
limit
offset
```

### 新增 / 更新策略追蹤

```http
POST /strategy-watchlist
```

主要 body：

```json
{
  "stock_code": "2330",
  "strategy_key": "legal_strength",
  "strategy_name": "法人轉強股",
  "source_trade_date": "2026-06-18",
  "source_score": 120,
  "source_rank": 1,
  "trigger_summary": "法人分數與籌碼分數符合條件"
}
```

### 移除策略追蹤

```http
DELETE /strategy-watchlist/:trackId
```

---

## 前端新增功能

### 新增頁籤

```text
策略追蹤
```

### 策略選股頁新增按鈕

```text
策略追蹤
```

加入後會變成：

```text
已追蹤
```

### 策略追蹤頁顯示內容

- 來源策略
- 加入時分數
- 目前籌碼分數
- 收盤價
- 股價位置
- 成交量狀態
- 來源日
- 追蹤時間
- 看明細
- 加入自選
- 移除追蹤

---

## 注意事項

策略追蹤是觀察清單，不是買賣建議。後續可以用來做策略回測或追蹤加入後 1 / 3 / 5 天表現。
