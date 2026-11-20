// api/ocr.js – OCR + 免费 LibreTranslate 翻译
// 已彻底移除对 dotenv 的运行时依赖，只通过 process.env 读取环境变量。

const OCR_API_KEY = process.env.OCR_API_KEY || "K8514202439429488957";

/**
 * 调用 LibreTranslate（免费开源）把文字翻译成中文。
 * - 默认公共实例：https://libretranslate.de/translate
 * - 如需自建实例，请在部署平台的环境变量中设置 LIBRE_TRANSLATE_URL
 * - 若请求被代理（agent‑egress）拦截，请确保已经在平台配置了 AGENT_EGRESS_TOKEN
 *
 * @param {string} originalText 需要翻译的原始文字
 * @returns {Promise<string|null>} 中文译文，或在出错时返回 null
 */
async function translateToChinese(originalText) {
  // ① 取得要请求的 URL；如果用户在 .env/Secrets 里自行配置了，会覆盖默认地址
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

    // ② 确认返回的是 JSON（防止返回 HTML 错误页）
    const contentType = resp.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      // 这里直接把错误信息打印出来，后端返回 null，前端会显示 “未返回译文”
      const text = await resp.text(); // 读取 HTML 错误页，便于排查
      console.error(
        `LibreTranslate failed: response is NOT JSON (Content-Type: ${contentType})\n` +
        `URL: ${libreUrl}\n` +
        `Status: ${resp.status} ${resp.statusText}\n` +
        `Body (truncated): ${text.slice(0, 500)}`
      );
      return null;
    }

    const data = await resp.json();
    // 正常情况下 data.translatedText 就是我们想要的中文译文
    return data.translatedText || null;
  } catch (e) {
    console.error("LibreTranslate failed:", e);
    return null;
  }
}

/* ------------------- 主处理函数 ------------------- */
module.exports = async (req, res) => {
  // 只接受 POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // 解析 multipart/form-data
  const formidable = require("formidable");
  const form = new formidable.IncomingForm();

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error("Form parse error:", err);
      return res.status(400).json({ error: "Invalid form data" });
    }

    const file = files.file;                 // 前端必须使用 name="file"
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fs = require("fs");
    const fileBuffer = fs.readFileSync(file.filepath);

    // 用 form-data 向 OcrSpace 发送请求
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

      // 处理 OcrSpace 错误
      if (json.IsErroredOnProcessing) {
        console.error("OcrSpace error:", json.ErrorMessage);
        return res
          .status(502)
          .json({ error: "OcrSpace processing error", details: json.ErrorMessage });
      }

      // 成功获取 OCR 文本后再调用翻译
      const parsedText = (json.ParsedResults?.[0]?.ParsedText || "").trim();
      const chinese = await translateToChinese(parsedText); // 可能为 null

      return res.status(200).json({ original: parsedText, chinese });
    } catch (e) {
      console.error("Fetch to OcrSpace failed:", e);
      return res.status(502).json({ error: "Failed to call OcrSpace", details: e.message });
    }
  });
};
