// api/ocr.js – OcrSpace 调用（使用 form-data，已去掉 language 参数）
// 放在项目根目录的 `api` 文件夹下，`server.js` 会把 POST /api/ocr 请求转发到这里

// dotenv 用于本地开发时读取 .env，生产环境通常通过平台 Secrets 注入环境变量
// 如需本地调试，请确保已执行 `npm install dotenv` 并在根目录放置 .env
// 本行已注释，避免在没有 dotenv 包的运行时抛错
// require('dotenv').config();

const OCR_API_KEY = process.env.OCR_API_KEY || "K8514202439429488957"; // 您的 OcrSpace API Key

/**
 * 判断字符串是否仅是 OCR 返回的“元信息 JSON”。
 * 这类内容通常像：
 *   {"OCRExitCode":1,"IsErroredOnProcessing":false,...}
 * 若是，则认为没有有效文字可翻译。
 */
function isMetadataOnly(text) {
  if (!text) return true;
  const trimmed = text.trim();

  // 可能是 JSON：先检查开头
  if (/^[\{\[]/.test(trimmed)) {
    const lower = trimmed.toLowerCase();
    if (
      lower.includes('"ocrexitcode"') ||
      lower.includes('"iserroredonprocessing"') ||
      lower.includes('searchablepdfurl')
    ) {
      return true;
    }
  }
  // 转义形式的 JSON（\"OCRExitCode\"）
  if (/\\\"ocrexitcode\\\"/.test(trimmed)) return true;
  return false;
}

/**
 * ==================== 翻译入口 ====================
 * 1️⃣ 首先尝试 **Google Translate**（官方免费公共 API，无需 API Key）。  
 * 2️⃣ 若 Google 不可用，则轮询 **LibreTranslate** 的公开实例。  
 *    - 如果您有自己的 LibreTranslate 实例或需要 API Key，可通过环境变量 `LIBRE_TRANSLATE_URL` 与 `LIBRE_TRANSLATE_API_KEY` 配置。  
 * 3️⃣ 所有服务均不可用时返回 `null`（前端可自行显示 “翻译不可用”）。
 */
async function translateToChinese(originalText) {
  const fetch = require("node-fetch");

  // -------- 1️⃣ Google Translate（免费公共 API） --------
  const googleUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(originalText)}`;
  try {
    const resp = await fetch(googleUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      timeout: 30000,
    });
    const data = await resp.json();

    // 返回结构类似 [[['译文','原文',...],...],...]
    if (Array.isArray(data) && Array.isArray(data[0])) {
      const translated = data[0].map(seg => seg[0]).join("");
      if (translated) return translated;
    }
    console.warn("Google Translate 返回非预期结构:", data);
  } catch (e) {
    console.warn("Google Translate 调用失败:", e.message);
  }

  // -------- 2️⃣ LibreTranslate 轮询（可自行添加 API Key） --------
  const libreUrls = [
    process.env.LIBRE_TRANSLATE_URL,                     // 环境变量优先
    "https://libretranslate.com/translate",               // 常用公共实例
    "https://translate.astian.org/translate",            // 备用实例
    "https://translate.argosopentech.com/translate"      // 再备
  ].filter(Boolean); // 去掉 undefined / 空字符串

  // 如果您有自己的 LibreTranslate 实例并且需要 API Key，设置以下环境变量：
  //   LIBRE_TRANSLATE_API_KEY = <your‑key>
  const libreApiKey = process.env.LIBRE_TRANSLATE_API_KEY;

  for (const url of libreUrls) {
    try {
      const headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "ocr-translate-client"
      };
      // 某些实例（如 libretranslate.com）要求在请求体里带 `api_key`
      const body = {
        q: originalText,
        source: "auto",
        target: "zh",
        format: "text"
      };
      if (libreApiKey) body.api_key = libreApiKey;

      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        timeout: 30000,
      });

      const ct = resp.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        console.warn(`LibreTranslate ${url} 返回非 JSON (Content-Type: ${ct})`);
        continue; // 继续尝试下一个实例
      }

      const data = await resp.json();

      // 成功返回字段可能是 `translatedText`（新版）或 `translation`（旧版）
      if (data && (data.translatedText || data.translation)) {
        return data.translatedText || data.translation;
      }

      console.warn(`LibreTranslate ${url} 未返回译文字段`, data);
    } catch (e) {
      console.warn(`LibreTranslate ${url} 调用异常:`, e.message);
    }
  }

  // -------- 3️⃣ 全部失败 ----------
  console.warn("所有翻译服务均不可用，返回 null");
  return null;
}

/**
 * ==================== 主处理函数 ====================
 */
module.exports = async (req, res) => {
  // ------------------- 只接受 POST -------------------
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  // ------------------- 解析 multipart/form-data -------------------
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

    // ------------------- 用 form-data 构造 OcrSpace 请求体 -------------------
    const FormData = require("form-data");
    const formData = new FormData();
    formData.append("apikey", OCR_API_KEY);
    // 已去掉 language 参数 → OcrSpace 会自行检测语言
    // formData.append("language", "chs,eng");
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

      // ------------------- 日志（方便调试） -------------------
      console.log("=== OcrSpace raw response ===");
      console.log(JSON.stringify(json, null, 2));

      // ------------------- 处理 OcrSpace 错误 -------------------
      if (json.IsErroredOnProcessing) {
        console.error("OcrSpace error:", json.ErrorMessage);
        res
          .status(502)
          .json({ error: "OcrSpace processing error", details: json.ErrorMessage });
        return;
      }

      // ------------------- 成功返回文字并翻译 -------------------
      const rawParsed = (json.ParsedResults?.[0]?.ParsedText || "").trim();
      const isMeta = isMetadataOnly(rawParsed);
      const parsedText = isMeta ? "" : rawParsed;               // 元信息视作空文字
      const chinese = isMeta ? null : await translateToChinese(parsedText);

      res.status(200).json({
        // 若是元信息，这里返回空字符串，前端自行决定是否展示
        original: parsedText,
        chinese,
      });
    } catch (e) {
      console.error("Fetch to OcrSpace failed:", e);
      res.status(502).json({ error: "Failed to call OcrSpace", details: e.message });
    }
  });
};
