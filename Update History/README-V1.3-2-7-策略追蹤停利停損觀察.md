# V1.3-2-7：策略追蹤停利停損觀察

## 一、完成內容

本版在策略追蹤功能中加入停利 / 停損觀察設定，讓每一筆策略追蹤可以獨立設定觀察門檻。

## 二、資料表調整

資料表：

```text
strategy_watchlists
```

新增欄位：

```text
take_profit_percent DECIMAL(8,4) NOT NULL DEFAULT 5.0000
stop_loss_percent DECIMAL(8,4) NOT NULL DEFAULT 3.0000
```

既有資料表可重新執行：

```bash
npm run strategy-watchlists:setup
```

此指令會自動補欄位，不會刪除既有追蹤資料。

## 三、後端 API

### 1. 更新停利停損設定

```http
PATCH /strategy-watchlist/:trackId/risk-settings
```

也支援：

```http
POST /strategy-watchlist/:trackId/risk-settings
```

Body 範例：

```json
{
  "take_profit_percent": 5,
  "stop_loss_percent": 3
}
```

## 四、策略追蹤回傳新增欄位

```text
take_profit_percent
stop_loss_percent
risk_observation_key
risk_observation_status
risk_observation_tone
distance_to_take_profit_percent
distance_to_stop_loss_percent
```

狀態說明：

```text
已達停利
已達停損
未觸發
等待資料
```

## 五、前端新增功能

策略追蹤頁新增：

```text
已達停利統計
已達停損統計
未觸發 / 待資料統計
每張追蹤卡片停利停損狀態
每張追蹤卡片停利 % / 停損 % 設定
只看已達停利
只看已達停損
只看未觸發
```

## 六、PWA 快取版本

```text
stock-radar-pwa-v39
```

## 七、驗收建議

```text
npm run strategy-watchlists:setup
```

部署後檢查：

```text
策略追蹤頁是否正常打開
是否能看到已達停利 / 已達停損統計
每張策略追蹤卡片是否出現停利 / 停損觀察區塊
是否能修改停利 %
是否能修改停損 %
儲存後重新整理是否保留
是否可篩選只看已達停利
是否可篩選只看已達停損
是否可篩選只看未觸發
```
