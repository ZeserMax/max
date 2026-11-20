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
 * 依次尝试一组 LibreTranslate 公共实例。
 * 第一个成功返回译文即结束；若全部失败抛异常进入回退。
 */
async function tryLibreTranslate(originalText) {
  const fetch = require("node-fetch");

  // ① 读取环境变量自定义实例（最高优先级）
  // ② 预置几个公开可达的实例（顺序从最可能可达到最可能被墙）
  const envUrl = process.env.LIBRE_TRANSLATE_URL;
  const predefined = [
    "https://libretranslate.com/translate",
    "https://translate.astian.org/translate",
    "https://translate.argosopentech.com/translate",
    // 如有需要，可再自行追加其他公开实例
  ];
  const urls = envUrl ? [envUrl, ...predefined] : predefined;

  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          // 部分实例在 301/302 时需要 User-Agent 才会跟随
          "User-Agent": "ocr-translate-client",
        },
        body: JSON.stringify({
          q: originalText,
          source: "auto",
          target: "zh",
          format: "text",
        }),
        timeout: 30000,
      });

      const ct = resp.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        // 很可能返回了 HTML（被拦截），直接尝试下一个实例
        console.warn(`LibreTranslate ${url} 返回非 JSON（Content-Type: ${ct})`);
        continue;
      }

      const data = await resp.json();
      if (data && (data.translatedText || data.translation)) {
        return data.translatedText || data.translation;
      }

      // 如果返回 JSON 但没有译文字段，视为失败继续尝试
      console.warn(`LibreTranslate ${url} 未返回译文字段`, data);
    } catch (e) {
      console.warn(`LibreTranslate ${url} 调用异常:`, e.message);
      // 继续尝试下一个实例
    }
  }

  // 若走到这里，说明所有 LibreTranslate 实例均不可用
  throw new Error("All LibreTranslate instances failed");
}

/**
 * MyMemory 免费翻译（配额极低，仅作最后兜底）。
 * 当配额用完时会返回形如 “YOU USED ALL AVAILABLE FREE TRANSLATIONS …”
 * 我们在捕获后返回一段提示信息，供前端自行提示用户。
 */
async function tryMyMemory(originalText) {
  const fetch = require("node-fetch");
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
    originalText
  )}&langpair=en|zh-CN`;

  const resp = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    timeout: 30000,
  });

  const data = await resp.json();

  // MyMemory 在配额耗尽时会把提示放在 responseData.translatedText
  if (data && data.responseData && data.responseData.translatedText) {
    const txt = data.responseData.translatedText;
    if (/YOU USED ALL AVAILABLE FREE TRANSLATIONS/.test(txt)) {
      // 把配额耗尽的提示直接返回，让调用方显示给用户
      return `【翻译服务配额已用尽】${txt}`;
    }
    return txt;
  }

  console.warn("MyMemory 未返回译文", data);
  return null;
}

// ---------- 主翻译入口（先 LibreTranslate → 再 MyMemory） ----------
async function translateToChinese(originalText) {
  // 1️⃣ 先尝试多实例 LibreTranslate
  try {
    return await tryLibreTranslate(originalText);
  } catch (e) {
    console.warn("所有 LibreTranslate 实例均不可用，准备使用 MyMemory 兜底:", e.message);
  }

  // 2️⃣ MyMemory 兜底（可能会因为配额耗尽而返回提醒）
  try {
    const mmResult = await tryMyMemory(originalText);
    if (mmResult) return mmResult;
  } catch (e) {
    console.error("MyMemory 调用异常:", e);
  }

  // 3️⃣ 若仍然没有译文，返回 null
  return null;
};

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
          // form-data 会自动生成合适的 Content‑Type（包含 boundary）
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

      // ------------------- 解析文字、过滤元信息 -------------------
      const rawParsed = (json.ParsedResults?.[0]?.ParsedText || "").trim();
      const isMeta = isMetadataOnly(rawParsed);
      const parsedText = isMeta ? "" : rawParsed; // 元信息视作空文字

      // ------------------- 翻译（若文字为空直接返回 null） -------------------
      let chinese = null;
      if (parsedText) {
        chinese = await translateToChinese(parsedText);
      }

      res.status(200).json({
        // 若是元信息，这里返回空字符串，前端可以自行决定是否展示
        original: parsedText,
        chinese,
      });
    } catch (e) {
      console.error("Fetch to OcrSpace failed:", e);
      res.status(502).json({ error: "Failed to call OcrSpace", details: e.message });
    }
  });
};
