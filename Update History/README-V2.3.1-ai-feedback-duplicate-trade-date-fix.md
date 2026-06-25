# V2.3.1 AI 回饋學習產生修正

## 修正項目
- 修正 `npm run ai-feedback:generate` 發生 `duplicate field name trade_date`。
- 原因：`ai_selection_signals s.*` 已包含 `trade_date`，SQL 又使用 `DATE_FORMAT(s.trade_date, '%Y-%m-%d') AS trade_date` 造成 MariaDB checkDuplicate 失敗。
- 修正：日期格式化欄位改為 `signal_trade_date_text`，並在 JS map 回 `trade_date`。

## 影響範圍
- 僅修正 V2.3 AI 推薦回饋學習產生腳本。
- 不變更資料表結構。
- 不影響 V2.2 / V2.1 / V2.0 既有功能。

## 驗收方式
```powershell
npm run ai-feedback:generate
npm run v23:test -- --api=http://localhost:3000
```
