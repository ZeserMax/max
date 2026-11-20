// api/ocr.js – OCR + 免费 LibreTranslate 翻译
// 只返回 { original, chinese }，不再依赖 dotenv

const OCR_API_KEY = process.env.OCR_API_KEY || "K8514202439429488957";

/**
 * 调用 LibreTranslate（免费开源）把文字翻成中文。
 * - 默认公共实例 https://libretranslate.de/translate
 * - 如需自建实例，请在部署平台的环境变量中设置 LIBRE_TRANSLATE_URL
 * - 若请求被代理（agent‑egress）拦截，请确保已经在平台配置了 AGENT_EGRESS_TOKEN
 */
async function translateToChinese(originalText) {
  const libreUrl = process.env.LIBRE_TRANSLATE_URL || "https://libretranslate.de/translate";
  const fetch = require("node-fetch");

  try {
    const resp = await fetch(libreUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: originalText,
        source: "auto",   // 自动检测源语言
        target: "zh",     // 目标语言：中文
        format: "text",
      }),
    });

    const data = await resp.json();
    // 如果代理返回错误，data 里不会有 translatedText，直接返回 null
    return data.translatedText || null;
  } catch (e) {
    console.error("LibreTranslate failed:", e);
    return null;   // 统一返回 null，前端会自行显示 “未返回译文”
  }
}

module.exports = async (req, res) => {
  // ------------------- 只接受 POST -------------------
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // ------------------- 解析 multipart/form-data -------------------
  const formidable = require("formidable");
  const form = new formidable.IncomingForm();

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error("Form parse error:", err);
      return res.status(400).json({ error: "Invalid form data" });
    }

    const file = files.file;               // 前端字段名必须是 "file"
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fs = require("fs");
    const fileBuffer = fs.readFileSync(file.filepath);

    // ------------------- 用 form-data 构造请求体 -------------------
    const FormData = require("form-data");
    const formData = new FormData();
    formData.append("apikey", OCR_API_KEY);
    // language 参数已去掉 → OcrSpace 自动检测语言
    formData.append("file", fileBuffer, {
      filename: file.originalFilename,
      contentType: "application/octet-stream",
    });

    const fetch = require("node-fetch");
    try {
      const response = await fetch("https://api.ocr.space/parse/image", {
        method: "POST",
        headers: {
          ...formData.getHeaders(),
          "User-Agent": "ocr-online-function",
        },
        body: formData,
        timeout: 30000,
      });

      const json = await response.json();

      // ------------------- OcrSpace 错误处理 -------------------
      if (json.IsErroredOnProcessing) {
        console.error("OcrSpace error:", json.ErrorMessage);
        return res
          .status(502)
          .json({ error: "OcrSpace processing error", details: json.ErrorMessage });
      }

      // ------------------- 成功 → 文字 + 翻译 -------------------
      const parsedText = (json.ParsedResults?.[0]?.ParsedText || "").trim();
      const chinese = await translateToChinese(parsedText); // 可能为 null

      return res.status(200).json({ original: parsedText, chinese });
    } catch (e) {
      console.error("Fetch to OcrSpace failed:", e);
      return res.status(502).json({ error: "Failed to call OcrSpace", details: e.message });
    }
  });
};
