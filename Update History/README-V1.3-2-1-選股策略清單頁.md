# V1.3-2-1 選股策略清單頁

## 本次目標

從 V1.3-1 的「自選股提醒」進入 V1.3-2 的「全市場策略選股」。

本版先完成：

```text
策略選股 API
前端策略選股頁籤
六種基礎策略清單
上市 / 上櫃市場切換
策略股票卡片
```

---

## 新增 API

```http
GET /strategies
```

支援參數：

```text
strategy
market
limit
date
```

範例：

```http
GET /strategies?strategy=legal_strength&market=上市&limit=30
GET /strategies?strategy=major_holder_accumulate&limit=30
GET /strategies?strategy=etf_calendar_watch&limit=30
```

---

## 新增策略

### 1. 法人轉強股

```text
legal_strength
```

條件重點：

```text
外資或投信買超
籌碼分數偏高
法人分數偏強
```

---

### 2. 主力增持股

```text
major_holder_accumulate
```

條件重點：

```text
400 張以上大戶比重增加
散戶比重下降或籌碼集中
使用 TDCC 週資料
```

---

### 3. 量價轉強股

```text
volume_price_breakout
```

條件重點：

```text
成交量分數偏強
股價位置偏強
接近高點或價格轉強
```

---

### 4. 資金流入股

```text
capital_inflow
```

條件重點：

```text
三大法人合計買超
成交金額與籌碼分數輔助排序
```

---

### 5. ETF 除息觀察

```text
etf_calendar_watch
```

條件重點：

```text
ETF 即將除息
收益分配或高重要性事件
30 天內事件
```

---

### 6. 短線強勢股

```text
short_term_strong
```

條件重點：

```text
籌碼分數 >= 80
股價不弱
量能與股價位置偏強
```

---

## 前端新增

新增頁籤：

```text
策略選股
```

頁面功能：

```text
策略切換
上市 / 上櫃市場切換
策略結果卡片
策略分數
觸發原因
看明細
加入自選
```

---

## PWA 快取版本

```text
stock-radar-pwa-v33
```

---

## 驗收項目

```text
策略選股頁籤是否出現
六個策略按鈕是否出現
點不同策略是否會重新載入
上市 / 上櫃切換是否正常
策略卡片是否正常顯示
看明細是否能打開股票明細
加入自選是否正常
ETF 除息觀察是否可正常顯示事件
```
