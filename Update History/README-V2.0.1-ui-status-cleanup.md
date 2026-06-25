# V2.0.1 UI 狀態資訊修正版

## 目標

- 修正 V2.0 上線後，我的頁與側邊欄仍顯示 V1.4 的問題。
- 將我的頁系統狀態檢查改為讀取 `/v20/status`。
- 避免 V2.0 API / PWA 版本被舊 V1.4 狀態卡誤判為異常。

## 修正項目

- 側邊功能選單版本文案改為 `V2.0 AI 多因子`。
- 我的頁狀態卡改為 `V2.0 系統狀態`。
- 狀態 API 改讀 `/v20/status`。
- 完成度改為 `V2.0 完成度`。
- 驗收提示改為 `/v20/status + npm run v201:test`。
- 策略、LINE、每日報告等頁面的舊 V1.4 版號文案改成正式功能名稱。
- PWA cache 版本升級到 `stock-radar-pwa-v71`。
- API 版本升級到 `stock-radar-api-v2.0.1`。

## 驗收指令

```powershell
npm run v201:test -- --api=http://localhost:3000
```
