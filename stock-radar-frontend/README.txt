第 2 項：個股查詢頁面正式版

覆蓋檔案：
- index.html
- app.js
- style.css
- service-worker.js

放置位置：
D:\code\stock-radar\stock-radar-frontend

更新重點：
1. 新增「個股查詢」分頁
2. 可輸入股票代號，例如 2330、2317、0050
3. 查詢 /stock/:stockCode/summary
4. 顯示最新行情、三大法人、籌碼狀態、分數拆解
5. 保留「看更多明細」彈窗
6. 記錄最近查詢股票代號到瀏覽器 localStorage
7. service-worker cache 版本更新為 v4，避免 PWA 吃到舊畫面
