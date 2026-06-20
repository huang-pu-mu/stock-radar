# V1.3-3-1-1 策略回測 Windows 執行修正

## 修正內容

修正 `scripts/generateStrategyBacktests.js` 在 Windows PowerShell 執行時只顯示 dotenv 訊息、沒有真正進入 main() 的問題。

## 原因

原本使用：

```js
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

在 Windows 路徑格式下可能比對失敗，導致 CLI 主程式沒有執行。

## 修正後

改用：

```js
const isCliExecution = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isCliExecution) {
  main();
}
```

## 驗收指令

```powershell
cd D:\code\stock-radar\stock-radar-api
npm run strategy-backtests:generate -- 2026-06-01 2026-06-18 --limit=5 --max-days=10
```

正常會看到：

```text
====================================
開始產生 V1.3-3-1 策略回測
Run ID：...
期間：...
交易日數：...
====================================
```
