// CaptionCraft AI - backend server
// ---------------------------------------------------------------
// What this file does:
//   1. Serves the frontend files (so you only need to start one thing).
//   2. Exposes two API routes:
//        GET  /api/status    -> tells the page whether a Gemini API key is set up
//        POST /api/generate  -> receives the image, asks Gemini, returns JSON
//   3. Keeps the API key on the server. The browser never sees it.
// ---------------------------------------------------------------

const path = require("path");
const express = require("express");
// Load variables from backend/.env (GEMINI_API_KEY, GEMINI_MODEL, PORT)
require("dotenv").config({ path: path.join(__dirname, ".env") });

const app = express();
const PORT = process.env.PORT || 3000;
// Default used when GEMINI_MODEL is empty. Change it in backend/.env, not here.
const DEFAULT_MODEL = "gemini-3.5-flash";
const API_KEY = (process.env.GEMINI_API_KEY || "").trim();
const MODEL = (process.env.GEMINI_MODEL || "").trim() || DEFAULT_MODEL;

// Allowed values (must match the options in the frontend)
const STYLES = ["Luxury", "Fashion", "Product", "Elegant", "Promotional", "Casual"];
const HASHTAG_COUNTS = [10, 20, 30];
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

// The frontend sends the image as base64 text inside JSON, so allow a larger body.
app.use(express.json({ limit: "15mb" }));
app.use(express.static(path.join(__dirname, "..", "frontend")));

// An empty key, or one still holding placeholder text, counts as "not configured".
function isConfigured() {
  return Boolean(API_KEY) && !/^your[_ ]/i.test(API_KEY);
}

// Writing guidance for each content style
const STYLE_GUIDE = {
  Luxury: "sophisticated and premium.",
  Fashion: "stylish and trendy.",
  Product: "product-focused and clear.",
  Elegant: "refined and minimal.",
  Promotional: "engaging and sales-oriented, without inventing discounts or offers.",
  Casual: "friendly and natural.",
};

// ---------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------
const SYSTEM_PROMPT = `You are an expert Instagram fashion and product copywriter.

Carefully analyze the uploaded image.
Identify only details that can reasonably be observed from the image.
Create one engaging Instagram caption and a list of relevant Instagram hashtags.
The caption should normally be approximately two lines.
The caption should sound natural, elegant, premium and human-written.
Match the selected content style.
Avoid generic AI-sounding phrases. Use emojis sparingly (one to three at most).
Do not put hashtags inside the caption.

Do not invent:
- prices
- discounts
- materials
- product specifications
- brand ownership
- shipping information
- availability
- product features that cannot be confirmed
- false claims

Generate exactly the number of hashtags requested by the user.
Hashtags must be relevant to the image. Mix broad and niche hashtags.

Return ONLY valid JSON in this format:
{"caption": "Your caption here", "hashtags": ["#Fashion", "#LuxuryStyle", "#FashionAccessories"]}

Do not include Markdown fences.
Do not include explanations outside the JSON.`;

function buildUserPrompt(style, count, previousCaption) {
  let prompt =
    `Content style: ${style} (${STYLE_GUIDE[style]})\n` +
    `Write exactly one caption of about two lines (use a line break between them).\n` +
    `Return exactly ${count} hashtags. Every hashtag must start with # and contain no spaces. No duplicates.`;

  if (previousCaption) {
    // Used by "Generate Again" so the wording changes.
    prompt +=
      `\n\nA previous caption was:\n"${previousCaption}"\n` +
      `Write a substantially different caption with fresh wording and a different opening. Do not reuse its phrases.`;
  }
  return prompt;
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

// The AI should return pure JSON, but we defend against stray text or code fences.
function parseAiJson(text) {
  const cleaned = String(text).replace(/```json|```/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON found");
  return JSON.parse(cleaned.slice(start, end + 1));
}

// Clean up hashtags: add "#", remove spaces/punctuation, remove duplicates.
function normalizeHashtags(list) {
  const seen = new Set();
  const result = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const word = String(raw).replace(/[^\p{L}\p{N}_]/gu, "");
    if (!word) continue;
    const tag = "#" + word;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

// Compare captions ignoring case, spacing and punctuation (to catch repeats).
function sameCaption(a, b) {
  const clean = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return Boolean(a) && Boolean(b) && clean(a) === clean(b);
}

// ---------------------------------------------------------------
// Retry for temporary Gemini failures
// ---------------------------------------------------------------
// Temporary problems (busy, rate limited, server hiccup) are retried up to 3 times,
// waiting 2s, then 4s, then 8s. Key or request errors (400/401/403) are NOT retried.
const RETRYABLE_STATUSES = [429, 500, 502, 503, 504];
const RETRY_DELAYS_MS = [2000, 4000, 8000];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchGeminiWithRetry(url, init) {
  for (let retry = 0; ; retry++) {
    const response = await fetch(url, init);

    const done =
      response.ok ||
      !RETRYABLE_STATUSES.includes(response.status) ||
      retry >= RETRY_DELAYS_MS.length;
    if (done) return response; // success, a non-retryable error, or out of retries

    const wait = RETRY_DELAYS_MS[retry];
    const details = await response.text().catch(() => "");
    console.warn(
      `Gemini returned HTTP ${response.status}. Retry ${retry + 1} of ${RETRY_DELAYS_MS.length} in ${wait / 1000}s. ` +
        details.replace(/\s+/g, " ").slice(0, 300)
    );
    await sleep(wait);
  }
}

// One call to Gemini. Returns { caption, hashtags } or throws.
async function askGemini({ base64, mediaType, style, count, previousCaption }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;

  const response = await fetchGeminiWithRetry(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // The key travels in a header (not the URL) so it is not logged anywhere.
      "x-goog-api-key": API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        {
          role: "user",
          parts: [
            { inline_data: { mime_type: mediaType, data: base64 } },
            { text: buildUserPrompt(style, count, previousCaption) },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json", // ask Gemini for JSON only
        temperature: 1,
        maxOutputTokens: 2048, // leaves room for the model's internal thinking
      },
    }),
  });

  if (!response.ok) {
    const err = new Error("Gemini request failed");
    err.status = response.status;
    err.details = await response.text().catch(() => "");
    throw err;
  }

  const data = await response.json();
  const candidate = data.candidates && data.candidates[0];
  if (!candidate || !candidate.content || !Array.isArray(candidate.content.parts)) {
    // Happens when Gemini blocks the request or returns nothing
    throw new Error("Empty Gemini response");
  }

  const text = candidate.content.parts
    .filter((part) => typeof part.text === "string")
    .map((part) => part.text)
    .join("");

  const parsed = parseAiJson(text);
  const caption = typeof parsed.caption === "string" ? parsed.caption.trim() : "";
  const hashtags = normalizeHashtags(parsed.hashtags);
  if (!caption) throw new Error("Missing caption");
  return { caption, hashtags };
}

// Detect a rejected key (Gemini can answer 400, 401 or 403 for this)
function isBadKeyError(err) {
  if (err.status === 401 || err.status === 403) return true;
  return err.status === 400 && /API_KEY_INVALID|API key not valid/i.test(err.details || "");
}

// ---------------------------------------------------------------
// Routes
// ---------------------------------------------------------------
app.get("/api/status", (req, res) => {
  res.json({ configured: isConfigured() });
});

app.post("/api/generate", async (req, res) => {
  // 1. Is the API key set up?
  if (!isConfigured()) {
    return res.status(503).json({
      error: "not_configured",
      message: "Gemini API key is not configured. Add GEMINI_API_KEY to backend/.env.",
    });
  }

  // 2. Validate what the browser sent
  const { image, mediaType, style, count, previousCaption } = req.body || {};
  const hashtagCount = Number(count);

  if (!image || typeof image !== "string") {
    return res.status(400).json({ error: "no_image", message: "Please upload an image first." });
  }
  if (!ALLOWED_TYPES.includes(mediaType)) {
    return res.status(400).json({ error: "bad_type", message: "Please upload a JPG, JPEG, PNG, or WEBP image." });
  }
  if (!STYLES.includes(style)) {
    return res.status(400).json({ error: "bad_style", message: "Please choose a content style." });
  }
  if (!HASHTAG_COUNTS.includes(hashtagCount)) {
    return res.status(400).json({ error: "bad_count", message: "Please choose 10, 20 or 30 hashtags." });
  }

  const previous = typeof previousCaption === "string" ? previousCaption.slice(0, 500) : "";

  // 3. Ask Gemini. Try up to 3 times if the hashtags are incomplete
  //    or (for Generate Again) the caption repeats the previous one.
  try {
    let result = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      result = await askGemini({
        base64: image,
        mediaType,
        style,
        count: hashtagCount,
        previousCaption: previous,
      });
      const enoughTags = result.hashtags.length >= hashtagCount;
      const isRepeat = sameCaption(result.caption, previous);
      if (enoughTags && !isRepeat) break;
    }

    if (!result || result.hashtags.length < hashtagCount || sameCaption(result.caption, previous)) {
      return res.status(502).json({
        error: "invalid_response",
        message: "Gemini returned an unexpected response. Please try again.",
      });
    }

    // Trim to the exact number requested
    result.hashtags = result.hashtags.slice(0, hashtagCount);
    return res.json(result);
  } catch (err) {
    console.error("Generate error:", err.status || "", err.message, String(err.details || "").slice(0, 1000));

    if (isBadKeyError(err)) {
      return res.status(502).json({
        error: "bad_key",
        message: "Gemini API key was rejected. Check backend/.env.",
      });
    }
    if (err.status === 429) {
      return res.status(429).json({
        error: "rate_limited",
        message: "Gemini rate limit reached. Please wait and try again.",
      });
    }
    if (err.status === 503) {
      return res.status(503).json({
        error: "busy",
        message: "Gemini is temporarily busy. Please wait a moment and try again.",
      });
    }
    if (err.status === 404) {
      console.error(`Model "${MODEL}" was not found for this API key. Run "npm run models" to list the models you can use.`);
    }
    if (err.status) {
      return res.status(502).json({
        error: "api_failure",
        message: "Gemini request failed. Please try again.",
      });
    }
    if (err instanceof SyntaxError || /JSON|caption|Empty/i.test(err.message)) {
      return res.status(502).json({
        error: "invalid_response",
        message: "Gemini returned an unexpected response. Please try again.",
      });
    }
    // fetch() itself failed (no internet, DNS problem)
    return res.status(502).json({
      error: "api_failure",
      message: "Gemini request failed. Please try again.",
    });
  }
});

// Startup check: ask Gemini which models this key can use and warn if ours is missing.
// It only logs. It never stops the server, and it never prints the key.
async function checkModel() {
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
      headers: { "x-goog-api-key": API_KEY },
    });
    if (!res.ok) {
      console.warn(`Model check skipped (HTTP ${res.status}). The key may be wrong. Generation will show the exact error.`);
      return;
    }
    const data = await res.json();
    const models = (data.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"));
    const found = models.some((m) => m.name === `models/${MODEL}`);
    if (found) {
      console.log(`Model check: "${MODEL}" is available for this key.`);
    } else {
      const flash = models
        .map((m) => m.name.replace("models/", ""))
        .filter((n) => /flash/i.test(n) && !/tts|live|image|audio|embed/i.test(n));
      console.warn(`Model check: "${MODEL}" is NOT available for this key. Set GEMINI_MODEL in backend/.env to one of: ${flash.join(", ") || "(none found)"}`);
    }
  } catch {
    console.warn("Model check skipped (could not reach Gemini).");
  }
}

app.listen(PORT, () => {
  console.log(`CaptionCraft AI running at http://localhost:${PORT}`);
  console.log(`Using Gemini model: ${MODEL}`);
  if (!isConfigured()) {
    console.log("Setup needed: add GEMINI_API_KEY to backend/.env (see backend/.env.example).");
  } else {
    checkModel();
  }
});
