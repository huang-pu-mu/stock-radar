# V1.4.8.6：市場雷達產業資金流向卡片標題修正

## 修正重點

市場雷達 > 產業資金流向清單的內容卡片標題，若資料庫仍回傳 TWSE 產業代碼，現在會改成中文名稱顯示。

範例：

- `20` → `其他`
- `08` → `玻璃陶瓷`
- `24` → `半導體業`
- `2403171008` → `半導體業、塑膠工業、金融保險、鋼鐵工業、玻璃陶瓷`

## 影響範圍

- `GET /radar/industry-flow`
- 前端 `renderIndustryFlowCard()`
- 每日報告產業清單前端保護轉換
- PWA Cache：`stock-radar-pwa-v60`
- API：`stock-radar-api-v1.4.8.6`

## 驗收

```bash
cd D:\code\stock-radar
node --check stock-radar-api\server.js
node --check stock-radar-frontend\app.js
```

前端驗收：

1. 進入「市場雷達」。
2. 點「產業資金流向」。
3. 檢查卡片標題不再顯示 `20`、`08`。
4. 預期顯示 `其他`、`玻璃陶瓷` 等中文產業名稱。
