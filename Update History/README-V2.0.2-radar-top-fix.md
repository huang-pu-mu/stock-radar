# 雷達之星 V2.0.2 今日雷達查詢修正

## 修正原因

正式 API `/radar/top` 查詢失敗：

```text
Error in results, duplicate field name `big_holder_status`.
```

原因是 V1.9 大戶持股模型加入 `bh.big_holder_status` 後，`/radar/top` 同時 SELECT：

- `bh.big_holder_status`
- `c.big_holder_status`

MariaDB Node driver 啟用 `checkDuplicate` 時會阻止重複欄位名稱，造成 HTTP 500。

## 修正內容

- 將大戶持股模型欄位改名為：`big_holder_trend_status`
- 保留原本籌碼分數欄位：`big_holder_status`
- 修正 `/radar/top` 查詢失敗
- 不影響 `/ai-selection/top`、`/v20/status`

## 驗收指令

```powershell
curl.exe -i "https://stock-radar-api-ten.vercel.app/radar/top?limit=5"
```

預期：HTTP 200。
