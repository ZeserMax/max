// api/ocr.js – OcrSpace 调用（使用 form-data 生成正确的 multipart）

const OCR_API_KEY = "K8514202439429488957"; // 您的 OcrSpace API Key

module.exports = async (req, res) => {
  // 只接受 POST
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  // 解析前端的 multipart/form-data（只取文件本身）
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

    // ---------- 这里使用 form-data ----------
    const FormData = require("form-data");
    const formData = new FormData();
    formData.append("apikey", OCR_API_KEY);
    formData.append("language", "chs+eng");
    // 直接把 Buffer 作为文件上传，保留原始文件名
    formData.append("file", fileBuffer, {
      filename: file.originalFilename,
      contentType: "application/octet-stream",
    });

    const fetch = require("node-fetch");
    try {
      const response = await fetch("https://api.ocr.space/parse/image", {
        method: "POST",
        headers: {
          // form-data 自动生成合适的 Content-Type（含 boundary）
          ...formData.getHeaders(),
          "User-Agent": "ocr-online-function",
        },
        body: formData,
        timeout: 30000,
      });

      const json = await response.json();

      // 在 Render 日志里打印完整返回，便于调试
      console.log("=== OcrSpace raw response ===");
      console.log(JSON.stringify(json, null, 2));

      // OcrSpace 错误（配额、文件大小、API Key 等）
      if (json.IsErroredOnProcessing) {
        console.error("OcrSpace error:", json.ErrorMessage);
        res
          .status(502)
          .json({ error: "OcrSpace processing error", details: json.ErrorMessage });
        return;
      }

      // 正常返回文字（如果没有文字则返回空串）
      const parsedText = (json.ParsedResults?.[0]?.ParsedText || "").trim();
      res.status(200).json({ text: parsedText });
    } catch (e) {
      console.error("Fetch to OcrSpace failed:", e);
      res.status(502).json({ error: "Failed to call OcrSpace", details: e.message });
    }
  });
};
