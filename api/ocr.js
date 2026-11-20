// api/ocr.js – OcrSpace 调用（使用 form-data，已去掉 language 参数）
// 放在项目根目录的 `api` 文件夹下，`server.js` 会把 POST /api/ocr 请求转发到这里

// ------- 已移除对 dotenv 的运行时依赖 ---------
// 生产环境会通过平台的 **Secrets / Environment Variables** 注入 OCR_API_KEY 等变量
// 如需本地调试，可自行在终端使用 `node -r dotenv/config server.js` 加载 .env

const OCR_API_KEY = process.env.OCR_API_KEY || "K8514202439429488957";

/**
 * 使用免费开源的 LibreTranslate 将文字翻译成中文。
 * - 默认使用公共实例 https://libretranslate.de/translate
 * - 如需自建实例，请在部署平台的环境变量中设置 LIBRE_TRANSLATE_URL
 *
 * @param {string} originalText 需要翻译的原始文字
 * @returns {Promise<string|null>} 中文译文，或在出错时返回 null
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
    return data.translatedText || null;
  } catch (e) {
    console.error("LibreTranslate failed:", e);
    return null;
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

    const file = files.file; // 前端字段名必须是 "file"
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fs = require("fs");
    const fileBuffer = fs.readFileSync(file.filepath);

    // ------------------- 用 form-data 构造请求体 -------------------
    const FormData = require("form-data");
    const formData = new FormData();
    formData.append("apikey", OCR_API_KEY);
    // language 参数已删除 → OcrSpace 将自动检测语言
    formData.append("file", fileBuffer, {
      filename: file.originalFilename,
      contentType: "application/octet-stream",
    });

    const fetch = require("node-fetch");
    try {
      const response = await fetch("https://api.ocr.space/parse/image", {
        method: "POST",
        headers: {
          // form-data 会自动生成合适的 Content-Type（包含 boundary）
          ...formData.getHeaders(),
          "User-Agent": "ocr-online-function",
        },
        body: formData,
        timeout: 30000,
      });

      const json = await response.json();

      // ------------------- 调试日志（可在生产中关闭） -------------------
      console.log("=== OcrSpace raw response ===");
      console.log(JSON.stringify(json, null, 2));

      // ------------------- 处理 OcrSpace 错误 -------------------
      if (json.IsErroredOnProcessing) {
        console.error("OcrSpace error:", json.ErrorMessage);
        return res
          .status(502)
          .json({ error: "OcrSpace processing error", details: json.ErrorMessage });
      }

      // ------------------- 成功返回文字并进行翻译 -------------------
      const parsedText = (json.ParsedResults?.[0]?.ParsedText || "").trim();
      const chinese = await translateToChinese(parsedText);
      return res.status(200).json({ original: parsedText, chinese });
    } catch (e) {
      console.error("Fetch to OcrSpace failed:", e);
      return res.status(502).json({ error: "Failed to call OcrSpace", details: e.message });
    }
  });
};
