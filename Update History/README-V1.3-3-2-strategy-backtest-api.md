# V1.3-3-2 策略回測 API

## 本次目標

把 V1.3-3-1 產生的策略回測資料，正式開放成 API，讓下一步可以接前端策略回測頁。

## 新增 API

### 1. 查詢回測任務清單

```http
GET /strategy-backtests/runs
```

支援參數：

```text
status
strategy
market
limit
offset
```

範例：

```http
GET /strategy-backtests/runs?status=completed&limit=10
```

---

### 2. 查詢單一回測任務明細

```http
GET /strategy-backtests/runs/:runId
```

範例：

```http
GET /strategy-backtests/runs/3
```

會回傳：

```text
回測任務基本資料
整體績效
各策略績效
成功 / 觀察 / 失敗 / 待資料統計
5 日最佳股票
5 日最弱股票
```

---

### 3. 查詢回測結果清單

```http
GET /strategy-backtests/results
```

支援參數：

```text
run_id
strategy
market
stock_code
outcome
search
sort
limit
offset
```

排序可用：

```text
signal_desc
signal_asc
score_desc
score_asc
1d_desc
1d_asc
3d_desc
3d_asc
5d_desc
5d_asc
latest_desc
latest_asc
stock_code_asc
stock_code_desc
```

範例：

```http
GET /strategy-backtests/results?run_id=3&strategy=legal_strength&sort=5d_desc&limit=20
```

---

### 4. 查詢回測摘要

```http
GET /strategy-backtests/summary
```

範例：

```http
GET /strategy-backtests/summary?run_id=3
```

如果沒有指定 `run_id`，會自動使用最新完成的回測任務。

---

### 5. 查詢回測排行榜

```http
GET /strategy-backtests/rankings
```

支援參數：

```text
run_id
metric
strategy
market
outcome
limit
```

`metric` 可用：

```text
1d
3d
5d
latest
```

範例：

```http
GET /strategy-backtests/rankings?run_id=3&metric=5d&limit=20
```

會回傳：

```text
整體平均報酬
整體勝率
各策略平均報酬排行
最佳股票排行
最弱股票排行
```

## 注意事項

```text
這版只做 API，還沒有新增前端策略回測頁。
```

下一步建議：

```text
V1.3-3-3：前端策略回測頁
```
