# REMEMBER OCR — Setup Guide

Everything you need to do manually before running the project.

---

## Step 1 — Prerequisites

Install these if you don't already have them.

### Node.js 20+
https://nodejs.org/en/download
Check: `node -v` → should print `v20.x.x` or higher.

### Ghostscript (only needed for scanned PDFs)
https://www.ghostscript.com/releases/gsdnld.html
→ Download the **64-bit Windows installer** and run it.
Check: open a new PowerShell and run `gswin64c --version`
If it prints a version, you're good.

> If you only deal with images and selectable-text PDFs, you can skip Ghostscript entirely.

---

## Step 2 — Google Cloud Vision API

This is the OCR engine. It's free for the first **1,000 image requests per month**.

### 2a — Create a Google Cloud project
1. Go to https://console.cloud.google.com/
2. Click the project dropdown at the top → **New Project**
3. Name it `remember-ocr` → **Create**

### 2b — Enable the Vision API
1. In the same console, go to: **APIs & Services → Library**
2. Search `Cloud Vision API` → click it → **Enable**

### 2c — Create a service account
1. Go to: **APIs & Services → Credentials**
2. Click **Create Credentials → Service Account**
3. Name: `remember-ocr-sa` → **Create and Continue**
4. Role: select **Cloud Vision API → Cloud Vision API User** → **Done**

### 2d — Download the JSON key
1. Click the service account you just created
2. Go to the **Keys** tab → **Add Key → Create New Key → JSON**
3. A `.json` file will download — keep it safe, treat it like a password

### 2e — Put the key in the project
```powershell
# From the remember-ocr folder:
mkdir credentials
# Move the downloaded JSON file into credentials/
# Rename it to google-vision-key.json
```

Your folder should look like:
```
remember-ocr/
  credentials/
    google-vision-key.json   ← the file you just downloaded
```

---

## Step 3 — Configure environment variables

The `.env` file was already created from `.env.example`. Open it and fill in these fields:

```powershell
notepad .env
```

Fields to update:

```env
# Your Google Cloud project ID (visible in the console top bar)
GOOGLE_CLOUD_PROJECT_ID="your-actual-project-id"

# Path to the key file (leave as-is if you put it in credentials/)
GOOGLE_APPLICATION_CREDENTIALS="./credentials/google-vision-key.json"

# Generate a strong secret:
# Run in PowerShell: [System.Convert]::ToBase64String((1..64 | ForEach-Object { Get-Random -Max 256 }))
JWT_SECRET="paste-the-output-here"
```

Everything else can stay as the defaults for local development.

---

## Step 4 — Create the uploads and temp folders

```powershell
mkdir uploads
mkdir tmp
```

---

## Step 5 — Run the database migration

This creates the local SQLite database file.

```powershell
npm run prisma:migrate
```

You will be prompted for a migration name — type `init` and press Enter.

---

## Step 6 — Start the server

```powershell
npm run dev
```

You should see:
```
info: REMEMBER OCR service started { port: 3001, env: 'development', provider: 'google_vision' }
```

The server is now running at: http://localhost:3001

---

## Step 7 — Verify it works

Open a new PowerShell tab and run a health check:

```powershell
Invoke-RestMethod http://localhost:3001/health
```

Expected response:
```json
{ "status": "ok", "service": "remember-ocr" }
```

---

## Step 8 — Run the tests

```powershell
npm test
```

All 35 tests should pass. These tests use a mock OCR provider so they work without Google credentials.

---

## Quick reference — all npm commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled production build |
| `npm test` | Run all tests |
| `npm run test:unit` | Run unit tests only |
| `npm run test:integration` | Run integration tests only |
| `npm run prisma:studio` | Open a visual database browser |
| `npm run prisma:migrate` | Apply schema changes to the database |

---

## Calling the API (example with PowerShell)

### 1. Get a JWT token
The server validates JWTs. For development, generate a test token:

```powershell
# Install jwt-cli globally (one-time):
npm install -g jsonwebtoken

# Or use Node.js directly to create a dev token:
node -e "
const jwt = require('jsonwebtoken');
const token = jwt.sign({ userId: 'user-123' }, 'replace-with-64-char-random-hex', { expiresIn: '7d' });
console.log(token);
"
```

Replace `replace-with-64-char-random-hex` with the same value you put in `.env` for `JWT_SECRET`.

### 2. Upload an image
```powershell
$token = "paste-your-token-here"
$headers = @{ Authorization = "Bearer $token" }
$memoryId = "memory-001"

# Upload a file
$response = Invoke-RestMethod `
  -Method POST `
  -Uri "http://localhost:3001/api/memories/$memoryId/ocr" `
  -Headers $headers `
  -Form @{ file = Get-Item "C:\path\to\your\image.jpg" }

$response
```

### 3. Poll for the OCR result
```powershell
Invoke-RestMethod `
  -Uri "http://localhost:3001/api/memories/$memoryId/ocr" `
  -Headers $headers
```

### 4. Get the LLM handoff payload
```powershell
Invoke-RestMethod `
  -Uri "http://localhost:3001/api/memories/$memoryId/ocr/handoff" `
  -Headers $headers
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `GOOGLE_APPLICATION_CREDENTIALS` error | Make sure the path in `.env` matches where the JSON file actually is |
| `Could not render any pages from the scanned PDF` | Install Ghostscript (Step 1) and restart the terminal |
| `Invalid or expired token` | Regenerate the JWT with the same `JWT_SECRET` that's in `.env` |
| Port 3001 already in use | Change `PORT=3002` in `.env` |
| `prisma:migrate` asks for a name | Type `init` and press Enter |
| Sharp install warning about missing binaries | Run `npm rebuild sharp` |

---

## Cost estimate (Google Vision)

- First **1,000 units/month** — free
- Each image = 1 unit
- Each PDF page OCR'd = 1 unit
- Selectable-text PDFs use `pdf-parse` (zero cost) — only scanned PDFs use Vision
- Full pricing: https://cloud.google.com/vision/pricing
