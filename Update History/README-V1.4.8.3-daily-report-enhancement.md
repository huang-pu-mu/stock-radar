# V1.4.8.3：每日策略報告補強

## 版本

- API：stock-radar-api-v1.4.8.3
- PWA Cache：stock-radar-pwa-v57

## 完成內容

1. 每日策略報告加入「今日重點摘要」。
2. 每日策略報告加入「回測最佳參數」。
3. 每日策略報告可切換績效指標：1 日、3 日、5 日、目前報酬。
4. LINE 外送內容同步加入今日重點與最佳參數。
5. 我的頁 / V1.4 狀態更新版本與模組進度。
6. `npm run v14:check` 新增 V1.4.8.3 檢查項目。

## 新增報告資料

- highlights：今日重點摘要。
- focus_summary：文字版重點摘要。
- optimization：保守 / 平衡 / 積極回測比較摘要。
- metric / metric_label：報告使用的績效指標。

## API 調整

### GET /strategy-daily-report

新增支援：

```text
metric=1d|3d|5d|current
```

### POST /strategy-daily-report/send-line

新增支援 body：

```json
{
  "metric": "5d"
}
```

## 驗收

```bash
node --check stock-radar-api/server.js
node --check stock-radar-frontend/app.js
node --check stock-radar-api/scripts/checkV13.js
cd stock-radar-api
npm run v14:check
```

結果：pass，138 / 138。
