/**
 * Integration tests — the full OCR pipeline with a mock provider.
 *
 * These tests exercise every stage without making real API calls.
 * Replace `MockProvider` with your real provider for E2E tests.
 */

import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import { setOCRProvider } from '../../src/providers/provider.factory';
import { OCRProvider } from '../../src/providers/OCRProvider.interface';
import { OCRInput, OCRResult } from '../../src/types/ocr.types';
import { runOCR } from '../../src/pipeline/ocr.pipeline';
import { normalizeText } from '../../src/normalization/text.normalizer';

const FIXTURE_DIR = path.join(__dirname, '../fixtures');
const TEMP_DIR = path.join(__dirname, '../fixtures/tmp');

// ── Mock provider ─────────────────────────────────────────────────────────────

class MockProvider implements OCRProvider {
  readonly name = 'mock';
  readonly returnText: string;

  constructor(text = 'MacBook Air M4\n₹94,990\nApple India\nAvailable now') {
    this.returnText = text;
  }

  async extractText(_input: OCRInput): Promise<OCRResult> {
    return {
      text: this.returnText,
      language: 'en',
      confidence: 0.97,
      provider: this.name,
      processedAt: new Date(),
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function makeImage(
  name: string,
  opts: {
    width?: number;
    height?: number;
    text?: string;
    format?: 'jpeg' | 'png' | 'webp';
    rotate?: number;
  } = {},
): Promise<string> {
  const { width = 800, height = 600, format = 'png', rotate = 0 } = opts;
  const p = path.join(FIXTURE_DIR, name);
  await fs.mkdir(FIXTURE_DIR, { recursive: true });

  let img = sharp({
    create: { width, height, channels: 3, background: { r: 240, g: 240, b: 240 } },
  });

  if (rotate) img = img.rotate(rotate);

  await img[format]().toFile(p);
  return p;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await fs.mkdir(FIXTURE_DIR, { recursive: true });
  await fs.mkdir(TEMP_DIR, { recursive: true });
  process.env['TEMP_DIR'] = TEMP_DIR;
  process.env['UPLOAD_DIR'] = FIXTURE_DIR;
  setOCRProvider(new MockProvider());
});

afterAll(async () => {
  await fs.rm(TEMP_DIR, { recursive: true, force: true }).catch(() => {});
});

// ── Test cases (mirrors GOAL.md §19) ─────────────────────────────────────────

describe('OCR Pipeline — Test Cases', () => {
  it('TC-01: clean screenshot', async () => {
    const filePath = await makeImage('tc01_clean.png');
    const result = await runOCR(filePath, 'mem-01', 'user-01');
    expect(result.text).toContain('₹94,990');
    expect(result.provider).toBe('mock');
  });

  it('TC-02: blurry screenshot (large image, downscaled)', async () => {
    const filePath = await makeImage('tc02_blurry.png', { width: 6000, height: 4000 });
    const result = await runOCR(filePath, 'mem-02', 'user-02');
    expect(result.text).toBeTruthy();
  });

  it('TC-03: receipt — preserves price after normalisation', async () => {
    setOCRProvider(new MockProvider('Item: Coffee\nQty: 2\n₹120\nSubtotal: ₹240\nGST: ₹43\nTotal: ₹283'));
    const filePath = await makeImage('tc03_receipt.png');
    const result = await runOCR(filePath, 'mem-03', 'user-03');
    expect(result.text).toContain('₹283');
    expect(result.text).toContain('GST');
  });

  it('TC-04: electricity bill — store name and invoice number preserved', async () => {
    setOCRProvider(new MockProvider('BESCOM\nInvoice No: 2024-08-001234\nDate: 15/08/2024\nAmount: ₹1,450'));
    const filePath = await makeImage('tc04_bill.png');
    const result = await runOCR(filePath, 'mem-04', 'user-04');
    expect(result.text).toContain('BESCOM');
    expect(result.text).toContain('2024-08-001234');
    expect(result.text).toContain('₹1,450');
  });

  it('TC-05: restaurant menu — items and prices', async () => {
    setOCRProvider(new MockProvider('Dal Makhani ₹280\nPaneer Tikka ₹350\nNaan ₹60'));
    const filePath = await makeImage('tc05_menu.png');
    const result = await runOCR(filePath, 'mem-05', 'user-05');
    expect(result.text).toContain('₹350');
  });

  it('TC-06: product screenshot', async () => {
    setOCRProvider(new MockProvider('MacBook Air M4\n₹94,990\nApple India\nAvailable now'));
    const filePath = await makeImage('tc06_product.png');
    const result = await runOCR(filePath, 'mem-06', 'user-06');
    expect(result.text).toContain('MacBook Air M4');
    expect(result.text).toContain('Apple India');
  });

  it('TC-07: Hindi text', async () => {
    setOCRProvider(new MockProvider('नमस्ते भारत\nयह एक परीक्षण है'));
    const filePath = await makeImage('tc07_hindi.png');
    const result = await runOCR(filePath, 'mem-07', 'user-07');
    expect(result.text).toContain('नमस्ते');
  });

  it('TC-08: English + Hindi mixed (Hinglish)', async () => {
    setOCRProvider(new MockProvider('₹500 ka recharge karna hai tomorrow'));
    const filePath = await makeImage('tc08_hinglish.png');
    const result = await runOCR(filePath, 'mem-08', 'user-08');
    expect(result.text).toContain('₹500');
    expect(result.text).toContain('recharge karna hai');
  });

  it('TC-11: image with no text returns empty string', async () => {
    setOCRProvider(new MockProvider(''));
    const filePath = await makeImage('tc11_notext.png');
    const result = await runOCR(filePath, 'mem-11', 'user-11');
    expect(result.text).toBe('');
  });

  it('TC-13: low-resolution image (upscaled before OCR)', async () => {
    const filePath = await makeImage('tc13_lowres.png', { width: 150, height: 100 });
    setOCRProvider(new MockProvider('Low res text'));
    const result = await runOCR(filePath, 'mem-13', 'user-13');
    expect(result.text).toBe('Low res text');
  });

  it('TC-14: URL-containing image — URL survives normalisation', async () => {
    const url = 'https://example.com/product?id=12345';
    setOCRProvider(new MockProvider(`Buy now: ${url}`));
    const filePath = await makeImage('tc14_url.png');
    const result = await runOCR(filePath, 'mem-14', 'user-14');
    expect(result.text).toContain(url);
  });

  it('TC-15: phone number-containing image', async () => {
    setOCRProvider(new MockProvider('Call us: +91 98765 43210'));
    const filePath = await makeImage('tc15_phone.png');
    const result = await runOCR(filePath, 'mem-15', 'user-15');
    expect(result.text).toContain('+91 98765 43210');
  });

  it('normalised text from TC-01 matches expected output', () => {
    const raw = 'MacBook Air M4\n₹94,990\nApple India\nAvailable now';
    const normalised = normalizeText(raw);
    expect(normalised).toBe('MacBook Air M4\n₹94,990\nApple India\nAvailable now');
  });
});

describe('OCR Pipeline — LLM Handoff contract', () => {
  it('result shape does NOT contain LLM-specific fields', async () => {
    setOCRProvider(new MockProvider());
    const filePath = await makeImage('handoff_test.png');
    const result = await runOCR(filePath, 'mem-hoff', 'user-hoff');

    // OCR result should only have these fields — no AI interpretation
    const allowed = new Set(['text', 'language', 'confidence', 'pages', 'provider', 'providerVersion', 'processedAt']);
    const actual = new Set(Object.keys(result));
    for (const key of actual) {
      expect(allowed.has(key)).toBe(true);
    }
  });
});
