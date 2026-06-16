# 圖表放大功能修改說明

本次修改前端看明細內的技術圖表，加入適合 iPad 查看細節的放大模式。

## 已完成

1. 看明細內的股價走勢圖新增「放大圖表」按鈕。
2. 放大後會開啟全螢幕圖表視窗。
3. 放大視窗內可切換區間：
   - 20日
   - 60日
   - 120日
   - 240日
   - 全部
4. 放大視窗內可左右拖曳查看前後 K 線。
5. 按「重設」會回到 60 日，並自動移到最新資料。
6. 放大圖表包含：
   - K 線 + MA5 / MA10 / MA20 / MA60 / MA120 / MA240
   - 成交量 + MV5 / MV20

## 覆蓋檔案

請覆蓋：

```text
stock-radar-frontend/index.html
stock-radar-frontend/app.js
stock-radar-frontend/style.css
```

## 上傳 GitHub

```powershell
cd D:\code\stock-radar

git status
git add .
git commit -m "新增技術圖表放大與區間切換"
git push
```

## iPad 若仍看到舊畫面

1. 等 Vercel 部署完成。
2. Safari 重新整理。
3. PWA 桌面捷徑若仍舊版，請刪除後重新加入主畫面。
4. 或到 Safari 清除網站資料後再開。

## 備註

本次只修改前端，沒有修改後端 API 與資料庫。
