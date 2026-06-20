# V1.3-2-4 策略追蹤後續表現統計

## 版本目標

讓「策略追蹤」不只是保存股票，而是可以開始檢查：

- 加入追蹤後 1 個交易日表現
- 加入追蹤後 3 個交易日表現
- 加入追蹤後 5 個交易日表現
- 目前報酬率
- 正報酬比例
- 各策略平均表現

## 後端新增

### 強化 `GET /strategy-watchlist`

回傳每筆追蹤資料時，新增：

```text
entry_price
entry_trade_date
day1_close_price
day1_trade_date
day1_return_percent
day3_close_price
day3_trade_date
day3_return_percent
day5_close_price
day5_trade_date
day5_return_percent
current_return_percent
performance_status
performance_status_text
performance_level
performance
```

### 新增 API

```http
GET /strategy-watchlist/performance
```

支援參數：

```text
strategy
stock_code
active
limit
offset
```

用途：

```text
專門查詢策略追蹤後續表現統計
```

## 前端新增

策略追蹤頁新增：

```text
平均目前報酬
正報酬比例
正 / 負 / 待資料
目前最佳追蹤
各策略目前表現
每檔股票 1 / 3 / 5 個交易日報酬
目前報酬
加入價
目前收盤
```

## 計算邏輯

```text
加入價：來源日當天收盤價；如果沒有該日價格，取來源日前最近一筆收盤價
1日報酬：來源日後第 1 個交易日收盤價 / 加入價
3日報酬：來源日後第 3 個交易日收盤價 / 加入價
5日報酬：來源日後第 5 個交易日收盤價 / 加入價
目前報酬：最新收盤價 / 加入價
```

## 狀態判斷

```text
目前報酬 >= 3%：轉強
目前報酬 <= -3%：轉弱
介於 -3% 到 3%：觀察中
沒有足夠價格資料：等待資料
```

## 注意

這是策略追蹤成效觀察，不是買賣建議。若資料日與加入時間差距過大，應以來源日與加入價為準判讀。
