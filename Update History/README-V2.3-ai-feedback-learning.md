# V2.3 AI 推薦回饋學習

## 版本目標

- 追蹤 V2.0 AI 多因子推薦後的實際表現。
- 建立推薦後 1 / 3 / 5 / 10 日報酬回饋。
- 標記 SUCCESS / PARTIAL / FAIL / WAITING。
- 統計各 AI 因子的實際績效。
- 產生因子權重調整建議。

## 新增資料表

- ai_recommendation_feedbacks
- ai_factor_performance_snapshots
- ai_factor_weight_suggestions

## 新增 API

- GET /ai-feedback/summary
- GET /ai-feedback/factors
- GET /ai-feedback/weights
- POST /ai-feedback/generate
- GET /v23/status
- GET /v23/acceptance

## 新增 scripts

- ai-feedback:setup
- ai-feedback:generate
- ai-feedback:daily
- v23:check
- v23:test

## 前端

- 新增 AI 回饋學習頁。
- 顯示推薦樣本、成功率、品質分數、平均報酬。
- 顯示因子績效與權重建議。

## 注意

- V2.3 初版只產生權重建議，不會自動調整 V2.0 公式。
- 不串券商、不自動下單。
