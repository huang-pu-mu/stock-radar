// 前端 API 設定檔
// 本機開發時會自動使用 LOCAL_API_BASE_URL
// 部署到 Vercel 後會自動使用 PRODUCTION_API_BASE_URL
window.STOCK_RADAR_CONFIG = {
  LOCAL_API_BASE_URL: "http://localhost:3000",

  // 正式部署前，把下面這行改成你的 Node.js API 正式網址
  // 例如：https://stock-radar-api.vercel.app
  PRODUCTION_API_BASE_URL: "https://stock-radar-api-ten.vercel.app",

  // Google 登入 Client ID
  // 已填入你的 Google OAuth Web Client ID
  GOOGLE_CLIENT_ID: "596345765350-f4beqp72m6188rdr6v6bu4vftdbuaog9.apps.googleusercontent.com",
};
