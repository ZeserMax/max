// api/ocr.js
// Node.js Serverless Function（兼容 Vercel、Render、Fly.io 等）
// 已经把您提供的 OcrSpace API Key 填入常量（如需更安全请改为环境变量）

const OCR_API_KEY = "K8514202439429488957";   // ← 您的 OcrSpace 免费 API Key

module.exports = async (req, res) => {
  // 只接受 POST 请求
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  // ----------------- 解析 multipart/form-data -----------------
  const formidable = require("formidable");
  const form = new formidable.IncomingForm();

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error("Form parse error:", err);
      res.status(400).json({ error: "Invalid form data" });
      return;
    }

    const file = files.file;
    if (!file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    // 读取上传的文件为 Buffer
    const fs = require("fs");
    const fileBuffer = fs.readFileSync(file.filepath);

    // ----------------- 调用 OcrSpace API -----------------
    const fetch = require("node-fetch");
    const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
    const crlf = "\r\n";

    const multipartBody = Buffer.concat([
      Buffer.from(
        [
          `--${boundary}`,
          `Content-Disposition: form-data; name="apikey"`,
          "",
          OCR_API_KEY,
          `--${boundary}`,
          `Content-Disposition: form-data; name="language"`,
          "",
          "chs+eng",                    // 简体中文 + 英文（可自行更改）
          `--${boundary}`,
          `Content-Disposition: form-data; name="file"; filename="${file.originalFilename}"`,
          "Content-Type: application/octet-stream",
          "",
        ].join(crlf)
      ),
      fileBuffer,
      Buffer.from(`${crlf}--${boundary}--${crlf}`),
    ]);

    try {
      const response = await fetch("https://api.ocr.space/parse/image", {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "User-Agent": "ocr-online-function",
        },
        body: multipartBody,
        timeout: 30000,          // 30 秒超时
      });

      const json = await response.json();

      // ----------------- 处理 OcrSpace 返回结果 -----------------
      if (json.IsErroredOnProcessing) {
        console.error("OcrSpace error:", json.ErrorMessage);
        res
          .status(502)
          .json({ error: "OcrSpace processing error", details: json.ErrorMessage });
        return;
      }

      const parsedText = (json.ParsedResults?.[0]?.ParsedText || "").trim();
      res.status(200).json({ text: parsedText });
    } catch (e) {
      console.error("Fetch to OcrSpace failed:", e);
      res.status(502).json({ error: "Failed to call OcrSpace", details: e.message });
    }
  });
};