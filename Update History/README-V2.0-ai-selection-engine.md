# 雷達之星 V2.0 AI 多因子選股引擎

## 完成項目

- 新增 ai_selection_signals / ai_selection_summaries。
- 新增 AI Strength Score。
- 整合籌碼、夜盤、全球風險、技術突破、主力籌碼、大戶趨勢與基本面。
- 新增 /ai-selection/latest、/ai-selection/top、/v20/status、/v20/acceptance。
- 新增 npm run v20:test 自動驗收與 log。

## 執行順序

```powershell
npm run ai-selection:setup
npm run ai-selection:generate
npm run v20:test -- --api=http://localhost:3000
```
