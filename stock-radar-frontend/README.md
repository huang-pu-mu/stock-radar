# 雷達之星 前端 PWA

## 本機測試

1. 先啟動後端 API

```powershell
cd D:\code\stock-radar\stock-radar-api
npm run dev
```

2. 用 VS Code Live Server 開啟前端

```text
D:\code\stock-radar\stock-radar-frontend\index.html
```

## 正式部署前要改的地方

打開 `config.js`，把：

```js
PRODUCTION_API_BASE_URL: "https://你的-api網址.vercel.app",
```

改成你的 Node.js API 正式網址。

## GitHub 上傳

```powershell
cd D:\code\stock-radar\stock-radar-frontend
git init
git add .
git commit -m "建立雷達之星前端 PWA"
```

如果 GitHub 已建立空 repo，接著執行：

```powershell
git branch -M main
git remote add origin 你的GitHubRepo網址
git push -u origin main
```

## Vercel 部署

```powershell
cd D:\code\stock-radar\stock-radar-frontend
vercel
```

正式部署：

```powershell
vercel --prod
```

## PWA 安裝測試

- Android Chrome：右上角選單 → 加到主畫面 / 安裝應用程式
- iPhone / iPad Safari：分享 → 加入主畫面
- Windows Chrome / Edge：網址列右側安裝圖示
