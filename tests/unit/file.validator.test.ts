import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import { validateFile } from '../../src/validation/file.validator';

const FIXTURE_DIR = path.join(__dirname, '../fixtures');

async function createTestImage(
  filePath: string,
  format: 'jpeg' | 'png' | 'webp',
  width = 200,
  height = 200,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    [format]()
    .toFile(filePath);
}

async function createPDF(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // Minimal valid PDF (1 page, no content)
  const minimalPDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
trailer<</Size 4/Root 1 0 R>>
startxref
190
%%EOF`;
  await fs.writeFile(filePath, minimalPDF);
}

describe('FileValidator', () => {
  beforeAll(async () => {
    await fs.mkdir(FIXTURE_DIR, { recursive: true });
  });

  it('accepts a valid JPEG', async () => {
    const p = path.join(FIXTURE_DIR, 'test.jpg');
    await createTestImage(p, 'jpeg');
    const result = await validateFile(p);
    expect(result.valid).toBe(true);
    expect(result.detectedMimeType).toBe('image/jpeg');
    await fs.unlink(p).catch(() => {});
  });

  it('accepts a valid PNG', async () => {
    const p = path.join(FIXTURE_DIR, 'test.png');
    await createTestImage(p, 'png');
    const result = await validateFile(p);
    expect(result.valid).toBe(true);
    expect(result.detectedMimeType).toBe('image/png');
    await fs.unlink(p).catch(() => {});
  });

  it('accepts a valid WebP', async () => {
    const p = path.join(FIXTURE_DIR, 'test.webp');
    await createTestImage(p, 'webp');
    const result = await validateFile(p);
    expect(result.valid).toBe(true);
    expect(result.detectedMimeType).toBe('image/webp');
    await fs.unlink(p).catch(() => {});
  });

  it('accepts a valid PDF', async () => {
    const p = path.join(FIXTURE_DIR, 'test.pdf');
    await createPDF(p);
    const result = await validateFile(p);
    expect(result.valid).toBe(true);
    expect(result.detectedMimeType).toBe('application/pdf');
    await fs.unlink(p).catch(() => {});
  });

  it('rejects a non-existent file', async () => {
    const result = await validateFile('/nonexistent/file.jpg');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('rejects an empty file', async () => {
    const p = path.join(FIXTURE_DIR, 'empty.jpg');
    await fs.writeFile(p, Buffer.alloc(0));
    const result = await validateFile(p);
    expect(result.valid).toBe(false);
    await fs.unlink(p).catch(() => {});
  });

  it('rejects a file with wrong extension but invalid magic bytes', async () => {
    const p = path.join(FIXTURE_DIR, 'fake.jpg');
    // Write a PNG file with a .jpg extension
    await fs.writeFile(p, Buffer.from('Not a real image file'));
    const result = await validateFile(p);
    expect(result.valid).toBe(false);
    await fs.unlink(p).catch(() => {});
  });

  it('rejects an image that is too small', async () => {
    const p = path.join(FIXTURE_DIR, 'tiny.png');
    await createTestImage(p, 'png', 10, 10); // below MIN_IMAGE_DIMENSION_PX
    const result = await validateFile(p);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/too small/i);
    await fs.unlink(p).catch(() => {});
  });
});
