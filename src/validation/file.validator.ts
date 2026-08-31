import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import {
  FileValidationResult,
  MAX_FILE_SIZE_BYTES,
  MAX_IMAGE_DIMENSION_PX,
  MIN_IMAGE_DIMENSION_PX,
  SUPPORTED_MIME_TYPES,
  OCRError,
  OCRErrorCode,
} from '../types/ocr.types';
import { readFileHead } from '../utils/hash';
import { logger } from '../utils/logger';

// ── Magic-byte MIME detection ─────────────────────────────────────────────────
// We never trust the client's Content-Type; we always read the file header.

function detectMimeFromMagicBytes(head: Buffer): string | null {
  // JPEG: FF D8 FF
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47 &&
    head[4] === 0x0d &&
    head[5] === 0x0a
  ) {
    return 'image/png';
  }
  // WebP: RIFF????WEBP
  if (
    head.slice(0, 4).toString('ascii') === 'RIFF' &&
    head.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  // PDF: %PDF
  if (head.slice(0, 4).toString('ascii') === '%PDF') {
    return 'application/pdf';
  }
  return null;
}

// ── Public validator ──────────────────────────────────────────────────────────

export async function validateFile(filePath: string): Promise<FileValidationResult> {
  // 1. File must exist
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return { valid: false, error: 'File not found or inaccessible.' };
  }

  // 2. Size limit
  if (stat.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `File exceeds the ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB limit (got ${(stat.size / 1024 / 1024).toFixed(1)} MB).`,
    };
  }

  if (stat.size === 0) {
    return { valid: false, error: 'File is empty.' };
  }

  // 3. Magic-byte MIME detection
  let head: Buffer;
  try {
    head = await readFileHead(filePath, 16);
  } catch {
    return { valid: false, error: 'Could not read file header.' };
  }

  const detectedMime = detectMimeFromMagicBytes(head);
  if (!detectedMime) {
    return {
      valid: false,
      error: 'Unsupported or unrecognised file format. Accepted: JPEG, PNG, WebP, PDF.',
    };
  }

  if (!(SUPPORTED_MIME_TYPES as string[]).includes(detectedMime)) {
    return {
      valid: false,
      error: `Detected MIME type '${detectedMime}' is not supported.`,
    };
  }

  // 4. Image-specific checks
  if (detectedMime.startsWith('image/')) {
    const imgResult = await validateImage(filePath);
    if (!imgResult.valid) {
      return { ...imgResult, detectedMimeType: detectedMime };
    }
  }

  return { valid: true, detectedMimeType: detectedMime };
}

async function validateImage(filePath: string): Promise<FileValidationResult> {
  let metadata: Awaited<ReturnType<typeof sharp.prototype.metadata>>;
  try {
    metadata = await sharp(filePath).metadata();
  } catch (err) {
    logger.debug('Sharp failed to read image metadata', { file: path.basename(filePath), err: String(err) });
    return { valid: false, error: 'Image appears to be corrupt or unreadable.' };
  }

  const { width = 0, height = 0 } = metadata;

  if (width < MIN_IMAGE_DIMENSION_PX || height < MIN_IMAGE_DIMENSION_PX) {
    return {
      valid: false,
      error: `Image is too small (${width}×${height}). Minimum: ${MIN_IMAGE_DIMENSION_PX}px on each side.`,
    };
  }

  if (width > MAX_IMAGE_DIMENSION_PX || height > MAX_IMAGE_DIMENSION_PX) {
    return {
      valid: false,
      error: `Image is too large (${width}×${height}). Maximum: ${MAX_IMAGE_DIMENSION_PX}px on each side.`,
    };
  }

  return { valid: true };
}

/** Throw an OCRError if the file fails validation. */
export async function assertValidFile(filePath: string): Promise<string> {
  const result = await validateFile(filePath);
  if (!result.valid) {
    const code = result.error?.includes('not found')
      ? OCRErrorCode.FILE_NOT_FOUND
      : result.error?.includes('corrupt')
      ? OCRErrorCode.CORRUPT_FILE
      : result.error?.includes('large')
      ? OCRErrorCode.FILE_TOO_LARGE
      : result.error?.includes('small')
      ? OCRErrorCode.IMAGE_TOO_SMALL
      : OCRErrorCode.INVALID_MIME_TYPE;

    throw new OCRError(result.error ?? 'File validation failed.', code, false);
  }
  return result.detectedMimeType!;
}
