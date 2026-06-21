# V1.4-5 每日策略報告

## 本次版本

- API：stock-radar-api-v1.4.5.0
- PWA Cache：stock-radar-pwa-v51

## 完成內容

1. 新增每日策略報告頁面。
2. 新增桌機左側「每日報告」功能。
3. 新增手機策略次功能「報告」。
4. 新增 `GET /strategy-daily-report` 報告預覽 API。
5. 新增 `POST /strategy-daily-report/send-line` LINE 外送 API。
6. 每日報告包含策略訊號分布、高分策略訊號、法人資金摘要、產業資金流向與 LINE 文字預覽。
7. 報告可依資料日、市場與高分清單數量重新產生。
8. Email / Telegram 依需求延後，本版只接 LINE 通知通道。
9. V1.4 驗收檢查更新至 100 項。

## 驗收方式

```bash
cd D:\code\stock-radar

node --check stock-radar-frontend\app.js
node --check stock-radar-api\server.js
node --check stock-radar-api\scripts\checkV13.js

cd stock-radar-api
npm run v14:check
```

## API 驗收

```http
GET /strategy-daily-report?market=上市&limit=10
```

登入後可測：

```http
POST /strategy-daily-report/send-line
```

Body：

```json
{
  "channel_id": 1,
  "market": "上市",
  "limit": 10
}
```

## 注意事項

- LINE 外送需要先完成 V1.4-4-1 通知通道設定。
- 若本機或 Vercel 尚未設定 `LINE_CHANNEL_ACCESS_TOKEN`，可以預覽報告，但不能實際外送。
- 每日報告是策略篩選摘要，不是買賣建議。
