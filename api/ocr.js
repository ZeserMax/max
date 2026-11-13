// api/ocr.js – OcrSpace 调用封装
// 把您的 OcrSpace API Key 填在下面
const OCR_API_KEY = "K8514202439429488957";

module.exports = async (req, res) => {
  // 只接受 POST
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  // 解析 multipart/form-data（使用 formidable）
  const formidable = require("formidable");
  const form = new formidable.IncomingForm();

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error("Form parse error:", err);
      res.status(400).json({ error: "Invalid form data" });
      return;
    }

    const file = files.file; // 前端字段名必须是 "file"
    if (!file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const fs = require("fs");
    const fileBuffer = fs.readFileSync(file.filepath);

    // 调用 OcrSpace API
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
          "chs+eng",
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
        timeout: 30000,
      });

      const json = await response.json();

      // **调试打印** – Render 日志里可以看到完整返回体
      console.log("=== OcrSpace raw response ===");
      console.log(JSON.stringify(json, null, 2));

      // OcrSpace 错误处理
      if (json.IsErroredOnProcessing) {
        console.error("OcrSpace error:", json.ErrorMessage);
        // 把错误直接返回前端，让 UI 能显示具体原因
        res
          .status(502)
          .json({ error: "OcrSpace processing error", details: json.ErrorMessage });
        return;
      }

      // 读取文字（如果没有则返回空串）
      const parsedText = (json.ParsedResults?.[0]?.ParsedText || "").trim();
      res.status(200).json({ text: parsedText });
    } catch (e) {
      console.error("Fetch to OcrSpace failed:", e);
      res
        .status(502)
        .json({ error: "Failed to call OcrSpace", details: e.message });
    }
  });
};
