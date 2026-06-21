# V1.4-2 策略參數最佳化

## 本次目標

新增策略參數最佳化第一版，讓前端可以用「保守 / 平衡 / 積極」三種參數預設，預覽不同門檻下的策略清單。

## 完成內容

1. 新增策略中心頁籤：策略最佳化。
2. 桌機左側功能列新增「策略最佳化」。
3. 手機策略次功能新增「最佳化」。
4. 新增 API：`GET /strategy-optimization/presets`。
5. `/strategies` 支援最佳化參數：
   - `preset`
   - `min_strategy_score`
   - `min_chip_score`
   - `min_legal_score`
   - `min_volume_score`
   - `min_price_score`
   - `min_total_net_lots`
   - `min_large_holder_ratio_change`
   - `event_window_days`
6. 新增 SQL：`strategy_parameter_presets`。
7. 新增 setup 指令：`npm run strategy-params:setup`。
8. 更新 V1.4 驗收檢查。

## 預設參數

| 預設 | 說明 |
|---|---|
| 平衡參數 | 保留 V1.3 的篩選精神，作為每日觀察基準 |
| 保守參數 | 提高分數與門檻，訊號較少 |
| 積極參數 | 降低部分門檻，訊號較多 |

## 版本

| 項目 | 版本 |
|---|---|
| API | `stock-radar-api-v1.4.2.0` |
| PWA Cache | `stock-radar-pwa-v48` |

## 驗收

```bash
cd D:\code\stock-radar
node --check stock-radar-frontend\app.js
node --check stock-radar-api\server.js

cd stock-radar-api
npm run v14:check
```

如需建立參數預設資料表：

```bash
cd D:\code\stock-radar\stock-radar-api
npm run strategy-params:setup
```
