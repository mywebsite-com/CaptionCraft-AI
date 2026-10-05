# CaptionCraft AI

Upload a product or fashion image and get an Instagram caption and hashtags. The image is sent to Google's **Gemini API**, which analyzes it and writes the text. There are no hardcoded or fake captions.

## How it works

```
Browser (frontend/)  ->  Node server (backend/server.js)  ->  Gemini API
   upload + preview        holds the API key, builds the        looks at the image
   copy buttons            prompt, checks the answer            and writes the text
```

The Gemini API key stays on the server in `backend/.env`. It never appears in HTML, CSS or browser JavaScript.

## Setup

### 1. Install Node.js

Install Node.js version 18 or newer from https://nodejs.org/ and check it with:

```powershell
node -v
```

### 2. Install dependencies

Open a terminal in the `captioncraft-ai` folder and run:

```powershell
npm install
```

### 3. Create `backend/.env`

Copy the example file.

Windows PowerShell:
```powershell
Copy-Item backend\.env.example backend\.env
```

macOS / Linux:
```bash
cp backend/.env.example backend/.env
```

### 4. Add your Gemini API key

Create a key in Google AI Studio (https://aistudio.google.com/apikey), then open `backend/.env` and fill it in:

```env
GEMINI_API_KEY=YOUR_KEY
GEMINI_MODEL=gemini-3.5-flash
PORT=3000
```

No quotes and no spaces. The model must support image input. Flash models do. Run `npm run models` to list the Flash models your key can use.

### 5. Start the app

```powershell
npm start
```

You should see `CaptionCraft AI running at http://localhost:3000`. The same command serves the backend and the frontend. For automatic restarts while editing code, use `npm run dev`.

### 6. Open the app

Go to **http://localhost:3000** in your browser.

## Never commit your API key

Your Gemini API key is a secret. Never upload `backend/.env` to GitHub and never paste the key into any file inside `frontend/`.

- `.gitignore` already lists `.env`, so Git skips it.
- `backend/.env.example` must stay empty (`GEMINI_API_KEY=`). It is the only env file that belongs on GitHub.
- If a key is ever exposed, delete it in Google AI Studio and create a new one.

## Using the app

1. Drag an image onto the upload area, or click to browse. JPG, JPEG, PNG and WEBP up to 10 MB are accepted.
2. Check the preview. Use **Replace image** or **Remove image** if needed.
3. Choose a content style and a hashtag count (10, 20 or 30).
4. Select **Generate Caption**.
5. Use **Copy Caption**, **Copy Hashtags** or **Copy All**. A small notice confirms each copy.
6. Select **Generate Again** for a different caption. The previous caption is sent to Gemini so it writes something new.

## Project structure

```
captioncraft-ai/
├── frontend/
│   ├── index.html     page layout
│   ├── style.css      design (ivory, burgundy, charcoal)
│   └── script.js      upload, preview, calls the backend, copy buttons
├── backend/
│   ├── server.js      Express server, prompt, Gemini call, response checks
│   └── .env.example   template for your secret settings
├── .gitignore
├── package.json
└── README.md
```

## Things you can change

- **Model:** set `GEMINI_MODEL` in `backend/.env`.
- **Port:** set `PORT` in `backend/.env`.
- **Writing instructions:** edit `SYSTEM_PROMPT` and `STYLE_GUIDE` in `backend/server.js`.
- **Styles or hashtag counts:** update the lists at the top of both `backend/server.js` and `frontend/script.js`, since the server validates them.
- **Colors:** edit the variables at the top of `frontend/style.css`.

## Troubleshooting

| Message | What to do |
| --- | --- |
| "Gemini API key is not configured" | Add `GEMINI_API_KEY` to `backend/.env`, then restart the server. |
| "Gemini API key was rejected" | The key is wrong or disabled. Create a new one in Google AI Studio. |
| "Gemini rate limit reached" | Wait a minute and try again. Free-tier limits are low. |
| "Gemini is temporarily busy" | Gemini was overloaded even after 3 automatic retries (2s, 4s, 8s). Wait a moment and try again. |
| "Gemini request failed" | Check your internet connection and the model name in `.env` (`npm run models` lists valid names). The terminal shows the detailed error. |
| "Network error" | The server is not running. Run `npm start`. |
| Port already in use | Change `PORT` in `backend/.env`. |

## Reliability

Temporary Gemini errors (HTTP 429, 500, 502, 503, 504) are retried automatically up to 3 times, waiting 2, 4 and 8 seconds. Errors caused by your key or request (400, 401, 403) are not retried. Each retry and the full error details are printed in the terminal. When the server starts it also checks that your `GEMINI_MODEL` exists for your key and prints a warning if it does not.

## Notes

- Large photos are shrunk in the browser to about 1568 px on the longest side before upload. This keeps requests fast.
- Each generation uses your Gemini quota. Add rate limiting before putting this on a public website.
