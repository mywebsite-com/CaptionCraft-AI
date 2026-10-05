// Lists the Gemini models your API key can use for generateContent.
// Run with:  npm run models
// It reads GEMINI_API_KEY from backend/.env and never prints it.

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const key = (process.env.GEMINI_API_KEY || "").trim();
if (!key) {
  console.error("GEMINI_API_KEY is missing in backend/.env");
  process.exit(1);
}

(async () => {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
    headers: { "x-goog-api-key": key },
  });
  if (!res.ok) {
    console.error(`Request failed: HTTP ${res.status}`);
    console.error((await res.text()).slice(0, 500));
    process.exit(1);
  }
  const data = await res.json();
  const names = (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => m.name.replace("models/", ""))
    .filter((n) => /flash/i.test(n) && !/tts|live|image|audio|embed/i.test(n))
    .sort();
  console.log("Flash models available for this key (all accept image input):\n");
  names.forEach((n) => console.log("  " + n));
  console.log("\nCurrent GEMINI_MODEL:", process.env.GEMINI_MODEL || "(not set, using the default)");
})().catch((e) => {
  console.error("Could not reach Gemini:", e.message);
  process.exit(1);
});
