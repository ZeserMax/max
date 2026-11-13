const express = require('express');
const path = require('path');
const ocrHandler = require('./api/ocr');

const app = express();

// Serve static files (index.html, etc.) from the project root
app.use(express.static(path.resolve(__dirname)));

// Route for OCR – delegate to the existing serverless function implementation
// We let the function parse multipart/form-data itself, so we don't apply body parsers here.
app.post('/api/ocr', (req, res) => {
  // Pass the raw request/response objects straight to the handler
  // The handler uses `formidable` to parse the incoming form data.
  ocrHandler(req, res);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
