# 雷達之星 V1.9 大戶持股模型

## 完成內容

- 新增 big_holder_trend_signals。
- 新增 big_holder_trend_summaries。
- 新增 Big Holder Trend Score。
- 新增 4 週 / 8 週大戶持股比例變化。
- 新增 4 週 / 8 週散戶人數變化。
- 新增籌碼集中 / 鬆動 / 出貨風險判斷。
- 新增 /big-holder-trend/latest、/big-holder-trend/top、/v19/status、/v19/acceptance。
- 新增 npm run v19:test 自動驗收與 log。

## 指令

```bash
npm run big-holder:setup
npm run big-holder:generate
npm run v19:test -- --api=http://localhost:3000
```
