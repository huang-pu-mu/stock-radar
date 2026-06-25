# V3.2 AI 每日推薦引擎

## 版本目標
- 讓雷達之星每天根據數據分析後產生推薦候選股票。
- 不只顯示排行，而是分成可買進、等拉回、觀察、禁買。
- 所有推薦都保留人工確認，不串券商、不自動下單。

## 新增內容
- SQL：stock-radar-api/sql/v32-ai-daily-recommendations.sql
- 資料表：ai_daily_recommendations、ai_recommendation_reasons、ai_recommendation_scores、ai_recommendation_performance、ai_recommendation_rules
- 腳本：setupAiDailyRecommendationsTables.js、generateAiDailyRecommendations.js、checkV32.js、runV32Acceptance.js
- API：/ai-recommendations/today、/ai-recommendations/performance、/ai-recommendations/:tradeDate、/ai-recommendations/:tradeDate/:stockCode、/v32/status、/v32/acceptance
- 前端：AI 每日推薦頁
- PWA：stock-radar-pwa-v79

## 驗收指令
```bash
npm run ai-recommendations:setup
npm run ai-recommendations:generate
npm run v32:check
npm run v32:test -- --skip-db
```
