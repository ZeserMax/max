// server.js – 简易的 Express 入口
const express = require('express');
const path = require('path');
const ocrHandler = require('./api/ocr');

const app = express();

// ① 直接提供项目根目录的所有静态资源（index.html、css、图片等）
app.use(express.static(path.resolve(__dirname)));

// ② 将 POST /api/ocr 请求交给原来的 Serverless 函数处理
app.post('/api/ocr', (req, res) => {
  // ocrHandler 会自行使用 formidable 解析 multipart/form-data
  ocrHandler(req, res);
});

// ③ Render 会把容器的端口注入为 process.env.PORT
const PORT = process.env.PORT || 3000; // 使用平台提供的端口或默认 3000

// 为了防止端口冲突，包装启动逻辑并在冲突时回退到 3000
const startServer = (port) => {
  const server = app.listen(port, () => {
    console.log(`🚀 Server listening on port ${port}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${port} already in use, trying fallback port 3000`);
      if (port !== 3000) {
        startServer(3000);
      } else {
        console.error('Fallback port 3000 also in use. Exiting.');
        process.exit(1);
      }
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });
};

startServer(PORT);
