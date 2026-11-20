// api/ocr.js – OcrSpace 调用（使用 form-data，已去掉 language 参数）
// 放在项目根目录的 `api` 文件夹下，`server.js` 会把 POST /api/ocr 请求转发到这里

// dotenv 用于本地开发时读取 .env，生产环境通常通过平台 Secrets 注入环境变量
// 如需本地调试，请确保已执行 `npm install dotenv` 并在根目录放置 .env
// 本行已注释，避免在没有 dotenv 包的运行时抛错
// require('dotenv').config();

const OCR_API_KEY = process.env.OCR_API_KEY || "K8514202439429488957"; // 您的 OcrSpace API Key

// ---------- 翻译函数（优先 LibreTranslate → 退回 MyMemory） ----------
async function translateToChinese(originalText) {
  // 统一使用 node-fetch
  const fetch = require("node-fetch");

  // LibreTranslate 地址（可通过 .env 覆盖）
  const libreUrl = process.env.LIBRE_TRANSLATE_URL ||
    "https://translate.argosopentech.com/translate";

  // ---------- 1️⃣ 试用 LibreTranslate ----------
  try {
    const resp = await fetch(libreUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        q: originalText,
        source: "auto",   // 自动检测源语言
        target: "zh",     // 目标语言：中文
        format: "text",
      }),
      timeout: 30000,
    });

    // 有时受限网络会返回 HTML 页面，需要检测 Content‑Type
    const ct = resp.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const data = await resp.json();
      // LibreTranslate 可能返回 `translatedText`（新版）或 `translation`（旧版）
      if (data && (data.translatedText || data.translation)) {
        return data.translatedText || data.translation;
      }
    }

    // 若返回的不是 JSON，抛出异常进入回退流程
    throw new Error("LibreTranslate returned non‑JSON");
  } catch (e) {
    console.warn(
      "LibreTranslate 调用失败，准备使用回退方案（MyMemory）：",
      e.message
    );
  }

  // ---------- 2️⃣ 回退到 MyMemory 免费翻译 ----------
  // MyMemory API 文档: https://mymemory.translated.net/doc/spec.php
  // 注意：免费版有频率限制，适合作为兜底方案
  try {
    const myMemoryUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
      originalText
    )}&langpair=en|zh-CN`;
    const resp = await fetch(myMemoryUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      timeout: 30000,
    });
    const data = await resp.json();
    if (data && data.responseData && data.responseData.translatedText) {
      return data.responseData.translatedText;
    }
    console.warn("MyMemory 未返回译文", data);
    return null;
  } catch (e) {
    console.error("MyMemory 翻译也失败了：", e);
    return null;
  }
}

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

    // ------------------- 用 form-data 构造请求体 -------------------
    const FormData = require("form-data");
    const formData = new FormData();
    formData.append("apikey", OCR_API_KEY);
    // **已删除 language 参数** → OcrSpace 将使用自动语言检测 (auto)
    // formData.append("language", "chs,eng");   // ← 这里注释掉
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
      const parsedText = (json.ParsedResults?.[0]?.ParsedText || "").trim();
      const chinese = await translateToChinese(parsedText);
      res.status(200).json({ original: parsedText, chinese });
    } catch (e) {
      console.error("Fetch to OcrSpace failed:", e);
      res.status(502).json({ error: "Failed to call OcrSpace", details: e.message });
    }
  });
};
