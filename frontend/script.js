// CaptionCraft AI - frontend logic
// ---------------------------------------------------------------
// Flow: choose image -> preview -> pick style + hashtag count ->
// send to our own backend (/api/generate) -> show caption + hashtags.
// No API key lives in this file. The backend talks to the AI.
// ---------------------------------------------------------------

const STYLES = ["Luxury", "Fashion", "Product", "Elegant", "Promotional", "Casual"];
const HASHTAG_COUNTS = [10, 20, 30];
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_IMAGE_SIDE = 1568; // we shrink big photos before sending (faster, and within AI limits)

// ---- Grab page elements ----
const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const fileInput = $("fileInput");
const previewWrap = $("previewWrap");
const previewImg = $("previewImg");
const uploadError = $("uploadError");
const generateError = $("generateError");
const generateBtn = $("generateBtn");
const setupBanner = $("setupBanner");
const emptyState = $("emptyState");
const resultCards = $("resultCards");
const captionText = $("captionText");
const hashtagText = $("hashtagText");

// ---- App state ----
let imageData = null; // { base64, mediaType } ready to send
let selectedStyle = "Luxury";
let selectedCount = 20;
let currentCaption = "";
let currentHashtags = [];
let isLoading = false;

// ---------------------------------------------------------------
// Setup: build option buttons and check whether the server has a key
// ---------------------------------------------------------------
function buildChips(containerId, values, selected, onSelect) {
  const container = $(containerId);
  container.innerHTML = "";
  values.forEach((value) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = value;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(value === selected));
    btn.addEventListener("click", () => {
      onSelect(value);
      container.querySelectorAll(".chip").forEach((chip) => {
        chip.setAttribute("aria-checked", String(chip === btn));
      });
    });
    container.appendChild(btn);
  });
}

buildChips("styleOptions", STYLES, selectedStyle, (v) => (selectedStyle = v));
buildChips("countOptions", HASHTAG_COUNTS, selectedCount, (v) => (selectedCount = v));

// Ask the backend if the API key is configured. Show a setup message if not.
async function checkSetup() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    setupBanner.hidden = data.configured;
  } catch {
    // Backend not reachable. Show a helpful message.
    showError(generateError, "Cannot reach the server. Start it with: npm start");
  }
}
checkSetup();

// ---------------------------------------------------------------
// Image upload (click, drag and drop, replace, remove)
// ---------------------------------------------------------------
dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});

["dragenter", "dragover"].forEach((type) =>
  dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.add("is-dragging");
  })
);
["dragleave", "drop"].forEach((type) =>
  dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.remove("is-dragging");
  })
);
dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) handleFile(file);
});

fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
  fileInput.value = ""; // lets the same file be chosen again later
});

$("replaceBtn").addEventListener("click", () => fileInput.click());
$("removeBtn").addEventListener("click", removeImage);

async function handleFile(file) {
  hideError(uploadError);
  hideError(generateError);

  if (!ALLOWED_TYPES.includes(file.type)) {
    return showError(uploadError, "Please upload a JPG, JPEG, PNG, or WEBP image.");
  }
  if (file.size > MAX_FILE_BYTES) {
    return showError(uploadError, "That image is larger than 10 MB. Please choose a smaller one.");
  }

  try {
    imageData = await prepareImage(file);
  } catch {
    imageData = null;
    return showError(uploadError, "We could not read that image. Please try a different file.");
  }

  previewImg.src = `data:${imageData.mediaType};base64,${imageData.base64}`;
  previewWrap.hidden = false;
  dropzone.hidden = true;
}

function removeImage() {
  imageData = null;
  previewImg.removeAttribute("src");
  previewWrap.hidden = true;
  dropzone.hidden = false;
  hideError(uploadError);
  hideError(generateError);
}

// Draw the image on a canvas to shrink it, then export as JPEG base64.
// Transparent PNGs get a white background so they do not turn black.
function prepareImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);

      const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
      resolve({ base64: dataUrl.split(",")[1], mediaType: "image/jpeg" });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image could not be loaded"));
    };
    img.src = url;
  });
}

// ---------------------------------------------------------------
// Generate caption + hashtags
// ---------------------------------------------------------------
generateBtn.addEventListener("click", () => generate(false));
$("againBtn").addEventListener("click", () => generate(true));

async function generate(isRetry) {
  if (isLoading) return;
  hideError(generateError);

  if (!imageData) {
    return showError(generateError, "Please upload an image first.");
  }

  setLoading(true);
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: imageData.base64,
        mediaType: imageData.mediaType,
        style: selectedStyle,
        count: selectedCount,
        // On "Generate Again" we send the old caption so the AI writes something new
        previousCaption: isRetry ? currentCaption : "",
      }),
    });

    let data = null;
    try {
      data = await res.json();
    } catch {
      /* response was not JSON */
    }

    if (!res.ok) {
      const message = (data && data.message) || "Something went wrong. Please try again.";
      if (data && data.error === "not_configured") setupBanner.hidden = false;
      throw new Error(message);
    }

    if (!data || typeof data.caption !== "string" || !Array.isArray(data.hashtags)) {
      throw new Error("Gemini returned an unexpected response. Please try again.");
    }

    showResults(data.caption, data.hashtags);
  } catch (err) {
    // fetch() itself failing (server off, no internet) throws a TypeError
    const isNetwork = err instanceof TypeError;
    showError(
      generateError,
      isNetwork ? "Network error. Check your connection and make sure the server is running." : err.message
    );
  } finally {
    setLoading(false);
  }
}

function setLoading(state) {
  isLoading = state;
  generateBtn.disabled = state;
  $("againBtn").disabled = state;
  generateBtn.classList.toggle("is-loading", state);
  generateBtn.querySelector(".btn-label").textContent = state ? "Analyzing image" : "Generate Caption";
}

function showResults(caption, hashtags) {
  currentCaption = caption;
  currentHashtags = hashtags;
  captionText.textContent = caption;
  hashtagText.textContent = hashtags.join(" ");

  emptyState.hidden = true;
  resultCards.hidden = false;
  // Restart the small fade-in animation each time
  resultCards.classList.remove("reveal");
  void resultCards.offsetWidth;
  resultCards.classList.add("reveal");
}

// ---------------------------------------------------------------
// Copy buttons + toast
// ---------------------------------------------------------------
$("copyCaptionBtn").addEventListener("click", () => copyText(currentCaption, "Caption copied"));
$("copyHashtagsBtn").addEventListener("click", () => copyText(currentHashtags.join(" "), "Hashtags copied"));
$("copyAllBtn").addEventListener("click", () =>
  copyText(`${currentCaption}\n\n${currentHashtags.join(" ")}`, "Caption and hashtags copied")
);

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for browsers that block the Clipboard API
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    if (!ok) return showToast("Copy failed. Select the text and copy it manually.");
  }
  showToast(message);
}

let toastTimer;
function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}

// ---------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------
function showError(el, message) {
  el.textContent = message;
  el.hidden = false;
}
function hideError(el) {
  el.textContent = "";
  el.hidden = true;
}
