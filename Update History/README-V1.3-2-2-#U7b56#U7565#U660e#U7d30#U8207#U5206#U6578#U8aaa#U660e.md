# V1.3-2-2 策略明細與策略分數說明

## 本次目標

把 V1.3-2-1 的「策略選股」從單純清單，升級成可以看懂的策略頁：

- 每個策略顯示判斷條件
- 每個策略顯示分數計算方式
- 每檔股票顯示為什麼被選出來
- 每檔股票顯示策略分數拆解
- 每檔股票顯示注意事項 / 風險提示
- 空資料時提供下一步建議

---

## 修改檔案

```text
stock-radar-api/server.js
stock-radar-frontend/app.js
stock-radar-frontend/style.css
stock-radar-frontend/service-worker.js
Update History/README-V1.3-2-2-策略明細與分數說明.md
```

---

## 後端新增功能

### 1. 策略定義強化

`STRATEGY_DEFINITIONS` 新增：

```text
criteria
score_formula
sort_reason
risk_tips
empty_tips
```

### 2. 新增策略說明 API

```http
GET /strategies/definitions
GET /strategies/definitions?strategy=legal_strength
```

### 3. `/strategies` 回傳資料強化

每筆策略股票現在多回傳：

```text
strategy_definition
score_breakdown
match_reasons
risk_flags
strategy_interpretation
sort_reason
```

---

## 前端新增功能

### 1. 策略頁上方新增策略說明卡

包含：

```text
判斷條件
分數怎麼算
排序原因
風險提醒
```

### 2. 策略股票卡片新增分數拆解

每張策略卡片會顯示：

```text
策略分數拆解
分項分數
進度條
分項說明
```

### 3. 策略股票卡片新增選出原因

會顯示：

```text
為什麼被選出來
注意事項
策略解讀
```

### 4. 空資料提示強化

若某策略沒有資料，畫面會顯示：

```text
可以怎麼做
```

例如切換市場、等待資料更新、改看其他策略。

---

## PWA 快取

已更新：

```text
stock-radar-pwa-v34
```

---

## 驗收項目

```text
前端策略選股頁可正常打開
六個策略按鈕可正常切換
策略頁上方有判斷條件 / 分數說明 / 風險提醒
每張策略卡片有策略分數拆解
每張策略卡片有為什麼被選出來
每張策略卡片有注意事項
空資料時有可以怎麼做提示
GET /strategies 可正常回傳 score_breakdown / match_reasons / risk_flags
GET /strategies/definitions 可正常回傳策略說明
手機 / iPad 看到新版畫面
```
