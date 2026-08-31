# REMEMBER OCR — Complete Project Reference

A complete guide for anyone building a frontend or integrating this service into a larger system.

---

## Table of Contents

1. [What This Service Does](#1-what-this-service-does)
2. [Architecture Overview](#2-architecture-overview)
3. [How to Run the Server](#3-how-to-run-the-server)
4. [Authentication](#4-authentication)
5. [API Reference](#5-api-reference)
6. [Complete Workflow (Step by Step)](#6-complete-workflow-step-by-step)
7. [OCR Status Lifecycle](#7-ocr-status-lifecycle)
8. [File Requirements](#8-file-requirements)
9. [What Happens to Your Image (Preprocessing Pipeline)](#9-what-happens-to-your-image-preprocessing-pipeline)
10. [PDF Handling](#10-pdf-handling)
11. [Text Normalization Rules](#11-text-normalization-rules)
12. [LLM Handoff Contract](#12-llm-handoff-contract)
13. [Indian Language Support](#13-indian-language-support)
14. [Rate Limits and Security](#14-rate-limits-and-security)
15. [Error Reference](#15-error-reference)
16. [Integration Examples](#16-integration-examples)

---

## 1. What This Service Does

This service takes an image or PDF and extracts the raw text from it.

**Input:** A JPEG, PNG, WebP, or PDF file.

**Output:** The text that appears in that file, plus metadata like language and confidence score.

**Example:**

You upload a screenshot of:
```
MacBook Air M4
₹94,990
Apple India
Available now
```

You get back:
```json
{
  "extractedText": "MacBook Air M4\n₹94,990\nApple India\nAvailable now",
  "language": "en",
  "confidence": 0.96,
  "provider": "google_vision"
}
```

### What this service does NOT do

| Does NOT | Why |
|---|---|
| Understand what the text means | That is the job of a separate LLM service |
| Classify memories | LLM responsibility |
| Create embeddings | Search layer responsibility |
| Answer questions about the content | LLM responsibility |
| Invent or correct text | OCR only extracts what is there |
| Summarize | LLM responsibility |

The rule is: **OCR = "What does the image say?"** Nothing more.

---

## 2. Architecture Overview

```
Your Frontend
     │
     │  HTTP (REST API)
     ▼
┌─────────────────────────────────────────────────────┐
│                REMEMBER OCR SERVICE                  │
│                  localhost:3001                       │
│                                                      │
│  POST /api/memories/:id/ocr  ─── Upload file         │
│                                                      │
│  ┌────────────────────────────────────────────┐     │
│  │            OCR PIPELINE                    │     │
│  │                                            │     │
│  │  1. Validate file (MIME, size, dimensions) │     │
│  │  2. Determine type (IMAGE or PDF)          │     │
│  │  3. Preprocess image                       │     │
│  │     • Auto-orient (EXIF)                  │     │
│  │     • Resize (upscale/downscale)           │     │
│  │     • Denoise (median filter)              │     │
│  │     • Grayscale                            │     │
│  │     • CLAHE (adaptive contrast)            │     │
│  │     • Deskew (angle correction)            │     │
│  │     • Sharpen (text edges)                 │     │
│  │  4. Send to OCR provider                   │     │
│  │  5. Normalize extracted text               │     │
│  │  6. Store result in database               │     │
│  └────────────────────────────────────────────┘     │
│                                                      │
│  GET  /api/memories/:id/ocr  ─── Poll result         │
│  POST /api/memories/:id/ocr/retry ── Retry           │
│  GET  /api/memories/:id/ocr/handoff ── For LLM       │
│                                                      │
│  Database: SQLite (dev.db)                           │
│  OCR Provider: Google Cloud Vision                   │
│  Temp files: ./tmp/ (auto-cleaned)                   │
│  Uploaded files: ./uploads/<userId>/<uuid>.<ext>     │
└─────────────────────────────────────────────────────┘
     │
     │  (later, separately)
     ▼
LLM Understanding Engine  ←── receives handoff payload
```

### Processing flow for every upload

```
UPLOAD REQUEST
     │
     ▼
Validate file ─── fail ──► 400 Bad Request (file rejected)
     │
     ▼
Save file to disk
     │
     ▼
Create DB record  (status = PENDING)
     │
     ▼
Return 202 Accepted  ◄── Your frontend gets this immediately
     │
     ▼  (background, async)
Preprocess image
     │
     ▼
Run OCR provider (Google Vision)
     │
     ▼
Normalize text
     │
     ▼
Save to DB  (status = COMPLETED / PARTIAL / FAILED)
     │
     ▼
Ready for polling
```

---

## 3. How to Run the Server

```bash
# Install dependencies (one time)
npm install

# Start in development mode (hot reload)
npm run dev

# Server starts at:
http://localhost:3001

# Swagger interactive API docs:
http://localhost:3001/api-docs
```

Health check — call this to verify the server is running:
```
GET http://localhost:3001/health
```
Returns:
```json
{ "status": "ok", "service": "remember-ocr" }
```

---

## 4. Authentication

Every `/api/*` endpoint requires a JWT token in the `Authorization` header.

```
Authorization: Bearer <your-jwt-token>
```

### Getting a token (development)

In development mode, call this endpoint to instantly get a token — no password needed:

```
GET http://localhost:3001/api/dev-token
```

Response:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "userId": "dev-user",
  "expiresIn": "7d"
}
```

Save the `token` value and use it in all subsequent API calls.

### Getting a token (production / custom userId)

```bash
node -e "
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { userId: 'your-user-id-here' },
  'your-jwt-secret-from-env',
  { expiresIn: '7d' }
);
console.log(token);
"
```

Replace `your-jwt-secret-from-env` with the value of `JWT_SECRET` from your `.env` file.

### How authentication works internally

1. Your request arrives with `Authorization: Bearer <token>`
2. The server verifies the JWT signature using `JWT_SECRET`
3. The `userId` is extracted from the token payload
4. All data operations are scoped to that `userId` — one user can never see another user's files

---

## 5. API Reference

### Base URL

```
http://localhost:3001
```

---

### `GET /health`

Check if the server is running.

**No authentication required.**

**Response 200:**
```json
{
  "status": "ok",
  "service": "remember-ocr"
}
```

---

### `GET /api/dev-token`

Generate a JWT for local development. **Only works when `NODE_ENV=development`.**

**No authentication required.**

**Response 200:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "userId": "dev-user",
  "expiresIn": "7d"
}
```

**Response 404:** Returned in production — endpoint is disabled.

---

### `POST /api/memories/:id/ocr`

Upload a file and start OCR processing.

**Parameters:**

| Parameter | Location | Type | Required | Description |
|---|---|---|---|---|
| `id` | URL path | string | ✅ | Your chosen memory ID. Can be any unique string. Example: `memory-001`, `photo-abc123` |
| `file` | Form body | file | ✅ | The image or PDF to process |

**Request format:** `multipart/form-data`

**Headers:**
```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**Body:**
```
file = <binary file data>
```

**Supported file types:**
- `image/jpeg` — JPEG images
- `image/png` — PNG images
- `image/webp` — WebP images
- `application/pdf` — PDF documents

**File size limit:** 50 MB (configurable in `.env` via `MAX_FILE_SIZE_MB`)

**Response 202 (success):**
```json
{
  "memoryId": "memory-001",
  "status": "PENDING",
  "message": "File saved. OCR is processing in the background."
}
```

The `202 Accepted` response means: the file was saved and OCR has been queued. OCR runs asynchronously — you must poll the GET endpoint to get the result.

**Response 400 (bad request):**
```json
{ "error": "No file uploaded." }
```
or
```json
{ "error": "File exceeds the 50 MB limit (got 67.2 MB)." }
```

**Response 401 (unauthorized):**
```json
{ "error": "Missing or malformed Authorization header." }
```
or
```json
{ "error": "Invalid or expired token." }
```

**Response 429 (rate limit):**
```json
{ "error": "Too many requests. Please slow down." }
```

---

### `GET /api/memories/:id/ocr`

Get the current OCR status and result for a memory.

**Parameters:**

| Parameter | Location | Type | Required | Description |
|---|---|---|---|---|
| `id` | URL path | string | ✅ | The memory ID you used when uploading |

**Headers:**
```
Authorization: Bearer <token>
```

**Response 200:**

```json
{
  "id": "clz1abc123def",
  "memoryId": "memory-001",
  "status": "COMPLETED",
  "extractedText": "MacBook Air M4\n₹94,990\nApple India\nAvailable now",
  "language": "en",
  "confidence": 0.96,
  "provider": "google_vision",
  "providerVersion": null,
  "processedAt": "2024-08-15T10:30:45.000Z",
  "errorMessage": null,
  "retryCount": 0,
  "pages": []
}
```

**Field descriptions:**

| Field | Type | Description |
|---|---|---|
| `id` | string | Internal database ID of the OCR result row |
| `memoryId` | string | The ID you provided when uploading |
| `status` | string | Current state — see [Status Lifecycle](#7-ocr-status-lifecycle) |
| `extractedText` | string \| null | The full extracted text. `null` if not yet processed or failed |
| `language` | string \| null | ISO 639-1 language code detected. Example: `"en"`, `"hi"`, `"mr"` |
| `confidence` | number \| null | Mean confidence score from the OCR provider (0.0 to 1.0) |
| `provider` | string | Which OCR engine was used. Example: `"google_vision"` or `"pdf-parse"` (for text PDFs) |
| `providerVersion` | string \| null | Version of the provider, if available |
| `processedAt` | ISO datetime \| null | When OCR completed |
| `errorMessage` | string \| null | Error description if `status` is `FAILED` |
| `retryCount` | number | How many times this memory has been retried |
| `pages` | array | For PDFs: per-page results. Empty array for single images |

**`pages` array item:**
```json
{
  "pageNumber": 1,
  "text": "Text from page 1...",
  "confidence": 0.94
}
```

**When to stop polling:**

Stop polling when `status` is one of:
- `COMPLETED` — success, `extractedText` is ready
- `FAILED` — permanent failure, `errorMessage` explains why
- `PARTIAL` — some pages succeeded, some failed (PDFs only)

Continue polling when `status` is:
- `PENDING` — queued, not started yet
- `PROCESSING` — currently running

**Recommended polling interval:** 2 seconds.

**Response 404:**
```json
{ "error": "Memory not found." }
```

---

### `POST /api/memories/:id/ocr/retry`

Re-queue OCR for a memory that has `FAILED` or `PARTIAL` status.

**Parameters:**

| Parameter | Location | Type | Required | Description |
|---|---|---|---|---|
| `id` | URL path | string | ✅ | The memory ID |

**Headers:**
```
Authorization: Bearer <token>
```

**Response 202 (retry queued):**
```json
{
  "memoryId": "memory-001",
  "status": "PENDING",
  "message": "OCR retry enqueued.",
  "retryCount": 1
}
```

**Response 409 (conflict):**
```json
{ "error": "OCR is already in progress." }
```

**Response 429 (max retries reached):**
```json
{ "error": "Maximum retry attempts reached." }
```

Maximum retries is controlled by `OCR_MAX_RETRIES` in `.env` (default: 3).

---

### `GET /api/memories/:id/ocr/handoff`

Get the minimal payload designed to be sent to a separate LLM understanding service.

**Only works when `status = COMPLETED`.**

**Parameters:**

| Parameter | Location | Type | Required | Description |
|---|---|---|---|---|
| `id` | URL path | string | ✅ | The memory ID |

**Headers:**
```
Authorization: Bearer <token>
```

**Response 200:**
```json
{
  "memoryId": "memory-001",
  "sourceType": "IMAGE",
  "extractedText": "MacBook Air M4\n₹94,990\nApple India\nAvailable now",
  "language": "en",
  "pages": []
}
```

**Field descriptions:**

| Field | Type | Description |
|---|---|---|
| `memoryId` | string | The memory ID |
| `sourceType` | `"IMAGE"` or `"PDF"` | What type of file was uploaded |
| `extractedText` | string | The full normalized extracted text |
| `language` | string \| null | Detected language code |
| `pages` | array | Per-page results for PDFs |

**Response 409 (not yet complete):**
```json
{ "error": "OCR is not yet complete." }
```

---

## 6. Complete Workflow (Step by Step)

Here is the full sequence your frontend needs to implement.

### Step 1: Get a token

```
GET /api/dev-token          (development only)
```

Save the `token` from the response.

### Step 2: Upload the file

```
POST /api/memories/my-photo-001/ocr
Authorization: Bearer <token>
Content-Type: multipart/form-data

Body: file = <your image>
```

You immediately get back:
```json
{ "memoryId": "my-photo-001", "status": "PENDING" }
```

### Step 3: Poll until done

Every 2 seconds, call:
```
GET /api/memories/my-photo-001/ocr
Authorization: Bearer <token>
```

Keep polling while `status` is `PENDING` or `PROCESSING`.
Stop when `status` is `COMPLETED`, `FAILED`, or `PARTIAL`.

### Step 4: Read the extracted text

When `status = COMPLETED`:
```json
{
  "extractedText": "MacBook Air M4\n₹94,990\nApple India\nAvailable now",
  "language": "en",
  "confidence": 0.96
}
```

The `extractedText` field is what your user wants to see.

### Step 5 (optional): Get the LLM handoff

If your system has an LLM layer, call:
```
GET /api/memories/my-photo-001/ocr/handoff
```

Send the response payload to your LLM service.

### Step 6 (if failed): Retry

```
POST /api/memories/my-photo-001/ocr/retry
```

Then go back to Step 3.

---

## 7. OCR Status Lifecycle

```
Upload ──► PENDING ──► PROCESSING ──► COMPLETED
                                  └──► PARTIAL
                                  └──► FAILED ──► (retry) ──► PENDING ...
```

| Status | Meaning | `extractedText` | Next action |
|---|---|---|---|
| `PENDING` | Queued, waiting to start | `null` | Keep polling |
| `PROCESSING` | OCR is running right now | `null` | Keep polling |
| `COMPLETED` | Success | ✅ Text is ready | Done |
| `PARTIAL` | Some pages succeeded (PDFs) | ✅ Partial text | Show partial, offer retry |
| `FAILED` | Permanent failure | `null` | Show error, offer retry |

**Important:** Even if OCR fails, the original uploaded file is preserved. The file is never deleted because OCR failed.

---

## 8. File Requirements

| Property | Limit |
|---|---|
| File size | Maximum 50 MB |
| Image formats | JPEG, PNG, WebP |
| Document formats | PDF |
| Minimum image dimensions | 32 × 32 pixels |
| Maximum image dimensions | 8,000 × 8,000 pixels |
| MIME detection | Done by reading the file's actual bytes, not the client-supplied Content-Type |

**Note:** The server reads the actual file bytes to detect the real type, so renaming a `.txt` file to `.jpg` will be caught and rejected.

---

## 9. What Happens to Your Image (Preprocessing Pipeline)

Before the image is sent to the OCR engine, it goes through this pipeline. This is similar to what AI companies like Google and Anthropic do internally to improve text extraction accuracy.

The original uploaded file is **never modified**. All preprocessing creates a temporary copy that is automatically deleted after OCR completes.

| Stage | Operation | Why |
|---|---|---|
| 1 | **Auto-orient** | Reads the EXIF `Orientation` tag and rotates the image correctly. Phone photos taken sideways are fixed automatically. |
| 2 | **Alpha removal** | Transparent PNG backgrounds are composited onto white so the image doesn't have a black background when converted to grayscale. |
| 3 | **Resize** | If the image is smaller than 800px on its shortest side, it is upscaled (improves character clarity). If larger than 4096px, it is downscaled (reduces cost and processing time). |
| 4 | **Denoise** | A 3×3 median filter removes salt-and-pepper noise (random black/white pixel specks) without blurring edges. |
| 5 | **Grayscale** | Converts to single-channel luminance. Colour information does not help OCR and can introduce noise. |
| 6 | **CLAHE** | Contrast Limited Adaptive Histogram Equalization. Divides the image into 8×8 tiles and equalises contrast in each tile independently. This handles images with shadows, uneven lighting, and reflections — the most common real-world problem. |
| 7 | **Deskew** | Detects the angle of text lines using a projection profile algorithm, then rotates the image to make text horizontal. Corrects photos taken at an angle. Searches ±15° in 0.5° steps. |
| 8 | **Sharpen** | Unsharp mask tuned for text character edges. Makes stroke boundaries crisper without adding halos in flat areas. |
| 9 | **Adaptive threshold** | (Only for receipts/bills when enabled.) Converts the image to pure black-and-white using local mean thresholding — handles receipts printed on thermal paper with uneven ink. |
| 10 | **PNG output** | Final preprocessed image is saved as lossless PNG for OCR ingestion. |

---

## 10. PDF Handling

The service handles two types of PDFs differently:

### Selectable-text PDF (digital PDF)

If a PDF was created by a word processor or exported from software, it contains actual text that can be selected and copied.

**Flow:**
```
PDF ──► Extract text directly (pdf-parse) ──► Normalize ──► Done
```

- No OCR is run on these PDFs
- The `provider` field in the result will be `"pdf-parse"`
- No Google Cloud Vision cost is incurred
- Processing is instant

### Scanned PDF (image-based PDF)

If a PDF was created by scanning physical paper, each page is just an image.

**Flow:**
```
PDF ──► Detect it's scanned ──► Render each page as PNG ──► Preprocess each page ──► OCR each page ──► Combine results
```

- Requires Ghostscript to be installed on the server
- The `provider` field will be `"google_vision"`
- Per-page results are available in the `pages` array
- Each page has its own `text` and `confidence`

### How the service tells which type

It extracts text and measures average characters per page. If there are fewer than 50 characters per page on average, it treats the PDF as scanned.

### Page numbers in results

For PDFs, the `pages` array preserves page numbers:
```json
{
  "pages": [
    { "pageNumber": 1, "text": "...", "confidence": 0.95 },
    { "pageNumber": 2, "text": "...", "confidence": 0.93 },
    { "pageNumber": 3, "text": "...", "confidence": 0.91 }
  ]
}
```

This allows your application to tell a user: *"This information was found on page 2."*

---

## 11. Text Normalization Rules

After OCR extracts text, it goes through normalization before being stored. This cleans up OCR artefacts without interpreting meaning.

**What normalization does:**

| Rule | Example (before → after) |
|---|---|
| Unicode NFC normalization | `e + combining accent` → `é` |
| Remove control characters | `hello\x00world` → `helloworld` |
| Normalize line endings | `line1\r\nline2` → `line1\nline2` |
| Trim trailing spaces per line | `hello   \n` → `hello\n` |
| Collapse 3+ blank lines to 2 | `a\n\n\n\nb` → `a\n\nb` |
| Collapse multiple spaces to one | `hello   world` → `hello world` |
| Trim leading/trailing whitespace | `   hello   ` → `hello` |

**What normalization preserves (never altered):**

- Prices and currencies: `₹94,990`, `$1,299`, `€499`
- Dates: `15/08/2024`, `2024-08-15`
- URLs: `https://example.com/product?id=123`
- Phone numbers: `+91 98765 43210`
- Meaningful line breaks between distinct text blocks

**What normalization does NOT do:**

- Spell-check or autocorrect words
- Use an LLM to "fix" the text
- Remove words it doesn't recognize
- Translate text

---

## 12. LLM Handoff Contract

The OCR service is designed to feed a separate LLM understanding service. The handoff endpoint (`GET /api/memories/:id/ocr/handoff`) returns exactly what the LLM layer needs.

**The contract:**

```
OCR service produces:    extractedText (what the image says)
LLM service consumes:    extractedText (to determine what it means)
```

**Example handoff for a product screenshot:**

```json
{
  "memoryId": "memory-001",
  "sourceType": "IMAGE",
  "extractedText": "MacBook Air M4\n₹94,990\nApple India\nAvailable now",
  "language": "en",
  "pages": []
}
```

The LLM then determines:
```
Product: MacBook Air M4
Price: ₹94,990
Brand: Apple
Category: Electronics
```

This separation is intentional. The OCR service never touches meaning, classification, or embeddings.

---

## 13. Indian Language Support

The OCR provider (Google Cloud Vision) is configured with language hints for Indian languages. This improves accuracy when the image contains non-English script.

**Supported Indian languages:**

| Language | ISO Code | Script |
|---|---|---|
| Hindi | `hi` | Devanagari |
| Bengali | `bn` | Bengali |
| Marathi | `mr` | Devanagari |
| Tamil | `ta` | Tamil |
| Telugu | `te` | Telugu |
| Kannada | `kn` | Kannada |
| Gujarati | `gu` | Gujarati |
| Punjabi | `pa` | Gurmukhi |
| Malayalam | `ml` | Malayalam |
| English | `en` | Latin |

**Mixed-language (Hinglish) example:**

Input image: `₹500 ka recharge karna hai tomorrow`

OCR output:
```json
{
  "extractedText": "₹500 ka recharge karna hai tomorrow",
  "language": "hi"
}
```

The text is preserved exactly as it appears, mixing scripts and languages. Normalization does not separate or translate it.

---

## 14. Rate Limits and Security

### Rate limits

| Setting | Default | Configure in `.env` |
|---|---|---|
| Window | 60 seconds | `RATE_LIMIT_WINDOW_MS` |
| Max requests per window | 30 | `RATE_LIMIT_MAX_REQUESTS` |

Exceeding the limit returns `429 Too Many Requests`.

### Security model

- **File isolation:** Uploaded files are stored in user-scoped directories (`uploads/<userId>/`). One user cannot access another user's files.
- **Ownership checks:** Every GET request verifies that the `userId` from the JWT matches the owner of the requested memory.
- **MIME validation:** The server reads the actual magic bytes of every uploaded file to detect its real type, regardless of what the client claims.
- **No sensitive content in logs:** The server logs structural metadata (memory IDs, file sizes, status) — never file content or extracted text.
- **Signed JWTs:** All tokens are verified using the `JWT_SECRET` from `.env`.

### Deduplication

If the same user uploads the exact same file twice (same SHA-256 hash), the server reuses the previous OCR result instead of running OCR again. This saves cost and time.

---

## 15. Error Reference

### HTTP status codes

| Code | Meaning |
|---|---|
| `200` | Success |
| `202` | Accepted — operation queued (upload and retry) |
| `400` | Bad request — invalid input |
| `401` | Unauthorized — missing or invalid JWT |
| `404` | Not found — memory ID does not exist or does not belong to you |
| `409` | Conflict — OCR already running, or not yet complete |
| `429` | Too many requests — rate limit or max retries exceeded |
| `500` | Internal server error |

### OCR error states

| Scenario | OCR status | What to tell the user |
|---|---|---|
| Provider unavailable | `FAILED` | "We couldn't read this file right now. Try again later." |
| Image too blurry / no text found | `COMPLETED` with empty `extractedText` | "No text was found in this image." |
| Scanned PDF but Ghostscript missing | `PARTIAL` | "We couldn't read some pages of this PDF." |
| File corrupt | `FAILED` | "This file appears to be damaged." |
| Rate limit from OCR provider | `FAILED` (retryable) | "Service is busy. Retry in a moment." |

---

## 16. Integration Examples

### JavaScript / Fetch (browser or Node.js)

#### Step 1: Get a dev token

```javascript
const res = await fetch('http://localhost:3001/api/dev-token');
const { token } = await res.json();
// Save token to localStorage or your state manager
localStorage.setItem('ocr_token', token);
```

#### Step 2: Upload a file

```javascript
async function uploadFile(memoryId, file) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`http://localhost:3001/api/memories/${memoryId}/ocr`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('ocr_token')}`,
      // Do NOT set Content-Type here — browser sets it automatically for FormData
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error);
  }

  return response.json(); // { memoryId, status: 'PENDING', message }
}
```

#### Step 3: Poll for result

```javascript
async function pollUntilDone(memoryId) {
  const TERMINAL = ['COMPLETED', 'FAILED', 'PARTIAL'];

  return new Promise((resolve, reject) => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`http://localhost:3001/api/memories/${memoryId}/ocr`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('ocr_token')}` },
        });

        const data = await res.json();

        if (TERMINAL.includes(data.status)) {
          clearInterval(timer);
          resolve(data);
        }
      } catch (err) {
        clearInterval(timer);
        reject(err);
      }
    }, 2000); // poll every 2 seconds
  });
}
```

#### Step 4: Put it all together

```javascript
async function extractTextFromFile(file) {
  const memoryId = 'mem-' + Date.now();

  // Upload
  await uploadFile(memoryId, file);

  // Poll
  const result = await pollUntilDone(memoryId);

  if (result.status === 'FAILED') {
    throw new Error(result.errorMessage || 'OCR failed');
  }

  return result.extractedText; // The text from the image
}

// Usage:
const fileInput = document.getElementById('myFileInput');
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const text = await extractTextFromFile(file);
  console.log('Extracted:', text);
});
```

#### Retry on failure

```javascript
async function retryOCR(memoryId) {
  const res = await fetch(`http://localhost:3001/api/memories/${memoryId}/ocr/retry`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${localStorage.getItem('ocr_token')}` },
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error);
  }

  // Poll again after retry
  return pollUntilDone(memoryId);
}
```

#### Get LLM handoff payload

```javascript
async function getLLMHandoff(memoryId) {
  const res = await fetch(`http://localhost:3001/api/memories/${memoryId}/ocr/handoff`, {
    headers: { 'Authorization': `Bearer ${localStorage.getItem('ocr_token')}` },
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error); // Usually "OCR is not yet complete."
  }

  return res.json();
  // { memoryId, sourceType, extractedText, language, pages }
}
```

---

### cURL examples

#### Health check
```bash
curl http://localhost:3001/health
```

#### Get dev token
```bash
curl http://localhost:3001/api/dev-token
```

#### Upload an image
```bash
curl -X POST http://localhost:3001/api/memories/memory-001/ocr \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -F "file=@/path/to/your/image.jpg"
```

#### Poll for result
```bash
curl http://localhost:3001/api/memories/memory-001/ocr \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

#### Retry a failed OCR
```bash
curl -X POST http://localhost:3001/api/memories/memory-001/ocr/retry \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

#### Get LLM handoff
```bash
curl http://localhost:3001/api/memories/memory-001/ocr/handoff \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

---

### Swagger UI (interactive testing)

Open this in your browser while the server is running:

```
http://localhost:3001/api-docs
```

1. Click **Authorize** at the top right
2. Paste your token (get one from `GET /api/dev-token`)
3. Click any endpoint → **Try it out** → **Execute**

This is the easiest way to explore and test the API without writing any code.
