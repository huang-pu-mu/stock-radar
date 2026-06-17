# V1.2.9 EPS 官方匯入修正說明

## 本次修正

修正 `npm run official:eps` 失敗問題。

原本 EPS 匯入腳本使用：

```text
https://mopsfin.twse.com.tw/opendata/t163sb04_L.csv
https://mopsfin.twse.com.tw/opendata/t163sb04_O.csv
```

目前這組網址會回傳 HTTP 404，所以已改成公開資訊觀測站 MOPS 的 `ajax_t163sb04` 查詢方式。

## 修改檔案

```text
stock-radar-api/scripts/importQuarterlyEps.js
```

## 新的匯入方式

執行：

```powershell
cd D:\code\stock-radar\stock-radar-api
npm run official:eps
```

預設會匯入最近 12 個已結束季度：

```text
上市
上櫃
```

## 指定單一季度匯入

也可以只匯入單一季度，例如 2026 Q1：

```powershell
node scripts/importQuarterlyEps.js 2026 1
```

或民國年也可以：

```powershell
node scripts/importQuarterlyEps.js 115 1
```

## 匯入後會寫入

```text
quarterly_eps
```

欄位包含：

```text
stock_code
eps_year
eps_quarter
eps
quarter_over_quarter_percent
year_over_year_percent
source
source_url
```

## 完成後檢查 SQL

```sql
USE stock_radar;

SELECT COUNT(*) AS total_count FROM quarterly_eps;

SELECT *
FROM quarterly_eps
ORDER BY eps_year DESC, eps_quarter DESC, stock_code
LIMIT 20;
```

## 注意

這次 EPS 匯入腳本不再使用 Yahoo 作為匯入來源。

如果公開資訊觀測站當季資料尚未公布，該季度會略過；只要最近 12 季其中有資料，匯入流程就會繼續完成。
