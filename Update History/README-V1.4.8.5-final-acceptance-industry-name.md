# V1.4.8.5：V1.4 正式封版檢查與每日報告產業名稱修正

## 一、本次版本

- API：`stock-radar-api-v1.4.8.5`
- PWA Cache：`stock-radar-pwa-v59`

## 二、本次修正重點

每日策略報告中的「法人資金流入產業」原本可能顯示 TWSE 產業代碼，例如：

- `24`
- `03`
- `17`
- `10`
- `08`

本次已改為顯示中文產業名稱：

- `24` → `半導體業`
- `03` → `塑膠工業`
- `17` → `金融保險`
- `10` → `鋼鐵工業`
- `08` → `玻璃陶瓷`

如果資料來源出現連續代碼字串，例如 `2403171008`，也會轉成：

```text
半導體業、塑膠工業、金融保險、鋼鐵工業、玻璃陶瓷
```

## 三、影響範圍

- 每日策略報告 API：`GET /strategy-daily-report`
- 每日策略報告 LINE 外送：`POST /strategy-daily-report/send-line`
- 每日報告頁面的法人資金流入產業區塊
- LINE 文字預覽中的法人資金流入產業

## 四、技術調整

新增後端產業代碼轉中文工具：

- `TWSE_INDUSTRY_CODE_NAME_MAP`
- `normalizeIndustryName()`
- `normalizeIndustryFlowRows()`

每日策略報告產業流向現在會在 API 回傳前先轉換為中文名稱，前端與 LINE 外送都會直接使用中文名稱。

## 五、V1.4 封版狀態

V1.4 本輪主要項目已完成：

- UI 改版
- 策略參數最佳化
- 回測條件調整
- LINE 通知外送
- LINE 自動綁定
- 每日策略報告
- 策略勝率趨勢
- 個股策略歷史紀錄
- V1.4 系統狀態與驗收檢查

Email 與 Telegram 通知依需求延後，不列入本輪 V1.4 封版。

## 六、驗收指令

```bash
cd D:\code\stock-radar

node --check stock-radar-frontend\app.js
node --check stock-radar-api\server.js
node --check stock-radar-api\scripts\checkV13.js

cd stock-radar-api
npm run v14:check
```

預期結果：

```text
結果：pass
```
