# 法人同步買超雷達修改說明

本次完成第 7 項：法人同步買超雷達。

## 已新增

1. 後端 API：`GET /radar/institutional-sync-buying`
2. 前端頁籤：`法人同步`
3. 支援市場篩選：全部、上市、上櫃
4. 卡片顯示：同步天數、外資今日買超、投信今日買超、法人合計、累計同步買超、籌碼分數、收盤價漲跌
5. 可直接加入自選股、看明細
6. Service Worker 版本更新為 `stock-radar-pwa-v11`，避免手機 PWA 卡住舊畫面

## 測試網址範例

後端部署完成後可以測：

```text
https://你的-api網址/radar/institutional-sync-buying
https://你的-api網址/radar/institutional-sync-buying?market=上市&limit=20
https://你的-api網址/radar/institutional-sync-buying?market=上櫃&limit=20
```

## 排名邏輯

排序優先順序：

1. 外資、投信連續同時買超天數越多越前面
2. 累計同步買超張數越大越前面
3. 今日同步買超張數越大越前面
4. 籌碼分數越高越前面
5. 股票代號由小到大
