// api/ocr.js – OcrSpace 调用 + 免费 LibreTranslate 翻译
// 已去掉对 dotenv 的依赖，所有配置通过 process.env 读取

// ------------------------------------------------------------
// ① 必要配置
// ------------------------------------------------------------
const OCR_API_KEY = process.env.OCR_API_KEY || "K8514202439429488957";

/**
 * 调用 LibreTranslate（免费开源）把文字翻译成中文。
 * - 默认官方实例：https://libretranslate.de/translate
 * - 若想使用自建实例，可在平台环境变量中设置 LIBRE_TRANSLATE_URL
 *
 * @param {string} originalText 需要翻译的原始文字
 * @returns {Promise<string|null>} 中文译文，出错时返回 null
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

    // ------------------------------------------------------------
    // ② 防止返回 HTML（如 403/404）导致 JSON 解析错误
    // ------------------------------------------------------------
    const contentType = resp.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const body = await resp.text(); // 读取错误页（便于排查）
      console.error(
        `LibreTranslate failed: response is NOT JSON (Content-Type: ${contentType})\n` +
        `URL: ${libreUrl}\n` +
        `Status: ${resp.status} ${resp.statusText}\n` +
        `Body (first 500 chars): ${body.slice(0, 500)}`
      );
      return null;
    }

    const data = await resp.json();
    return data.translatedText || null;
  } catch (e) {
    console.error("LibreTranslate failed:", e);
    return null;
  }
}

/* ------------------- 主处理函数 ------------------- */
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

    const file = files.file; // 前端必须使用 name="file"
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fs = require("fs");
    const fileBuffer = fs.readFileSync(file.filepath);

    // ------------------- 用 form-data 构造请求体 -------------------
    const FormData = require("form-data");
    const formData = new FormData();
    formData.append("apikey", OCR_API_KEY);
    // language 参数已删除 → OcrSpace 自动检测语言
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
