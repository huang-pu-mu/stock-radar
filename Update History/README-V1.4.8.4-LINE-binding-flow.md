# V1.4.8.4 LINE 綁定流程優化

## 目標

讓使用者不需要手動尋找 LINE `U` 開頭 User ID，可在通知外送頁產生綁定碼，然後到 LINE 對 Bot 傳送：

```text
綁定 123456
```

系統會透過 LINE Webhook 自動取得 User ID / Group ID / Room ID，並建立 LINE 通知通道。

## 完成內容

1. 新增 `notification_line_bindings` 資料表。
2. 新增 `GET /notification/line-bindings`。
3. 新增 `POST /notification/line-bindings`。
4. 新增 `POST /line/webhook`。
5. 新增 LINE Webhook 簽章驗證，使用 `LINE_CHANNEL_SECRET`。
6. 通知外送頁新增「LINE 自動綁定」卡片。
7. 支援產生 6 碼綁定碼。
8. 支援在 LINE 傳送 `綁定 123456` 後自動建立通知通道。
9. 綁定成功後 Bot 會回覆綁定成功訊息。
10. `npm run notifications:setup` 會建立新的綁定資料表。
11. `npm run v14:check` 更新到 V1.4.8.4。

## 環境變數

```env
LINE_CHANNEL_ACCESS_TOKEN=你的 LINE Messaging API Channel access token
LINE_CHANNEL_SECRET=你的 LINE Messaging API Channel secret
```

## LINE Developers 設定

Webhook URL：

```text
https://你的-api網域/line/webhook
```

需開啟：

```text
Use webhook: Enabled
```

## 版本

- API：`stock-radar-api-v1.4.8.4`
- PWA：`stock-radar-pwa-v58`
