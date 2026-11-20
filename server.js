const express = require('express');
const path = require('path');
const ocrHandler = require('./api/ocr');

const app = express();
app.use(express.static(path.resolve(__dirname)));

app.post('/api/ocr', (req, res) => {
  ocrHandler(req, res);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server listening on port ${PORT}`));
