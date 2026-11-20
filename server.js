// server.js – 简易的 Express 入口
const express = require('express');
const path = require('path');
const ocrHandler = require('./api/ocr');

const app = express();

// 提供项目根目录的所有静态资源（index.html、CSS、图片等）
app.use(express.static(path.resolve(__dirname)));

// 将 POST /api/ocr 请求交给上面的 handler
app.post('/api/ocr', (req, res) => {
  ocrHandler(req, res);
});

// Render（或部署平台）会注入容器端口到 process.env.PORT
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
