# V1.4-4-1：LINE 通知外送

## 完成日期

2026-06-21

## 版本

- API：stock-radar-api-v1.4.4.1
- PWA Cache：stock-radar-pwa-v50

## 完成內容

1. 新增通知外送資料表：
   - notification_channels
   - notification_send_logs
2. 新增 LINE Messaging API 通知設定 API：
   - GET /notification/channels
   - POST /notification/channels/line
   - PATCH /notification/channels/:channelId
   - DELETE /notification/channels/:channelId
   - POST /notification/channels/:channelId/test
3. 新增前端「通知外送」頁面。
4. 支援新增 LINE User ID / Group ID / Room ID。
5. 支援啟用 / 停用 / 刪除通知通道。
6. 支援 LINE 測試發送。
7. 新增 npm run notifications:setup。
8. V1.4 驗收檢查更新到 92 項。

## 環境變數

```env
LINE_CHANNEL_ACCESS_TOKEN=你的 LINE Messaging API Channel access token
```

## 本機套用後執行

```bash
cd D:\code\stock-radar\stock-radar-api
npm run notifications:setup
npm run v14:check
```

## 注意事項

LINE Notify 已不適合作為新功能長期方案，本版使用 LINE Messaging API 架構。
