/**
 * OCR PIPELINE
 *
 * FILE UPLOAD
 *   ↓ VALIDATE FILE
 *   ↓ DETERMINE TYPE  (IMAGE | PDF)
 *   ↓ PREPROCESS      (images only — temp copy)
 *   ↓ TEXT EXTRACTION
 *   ↓ NORMALIZATION
 *   ↓ RETURN OCRResult
 *
 * The pipeline:
 *  - Never modifies the original file
 *  - Cleans up all temp files after completion
 *  - Handles selectable-text PDFs and scanned PDFs differently
 *  - Returns a clean OCRResult ready for LLM handoff
 */

import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  OCRInput,
  OCRResult,
  OCRError,
  OCRErrorCode,
  OCRPage,
  PreprocessingOptions,
  SupportedMimeType,
} from '../types/ocr.types';
import { assertValidFile } from '../validation/file.validator';
import { ImagePreprocessor } from '../preprocessing/image.preprocessor';
import {
  extractSelectableText,
  renderPDFPages,
} from '../extraction/pdf.extractor';
import { extractTextFromImage } from '../extraction/image.extractor';
import { normalizeText, normalizePages } from '../normalization/text.normalizer';
import { getOCRProvider } from '../providers/provider.factory';
import { withTempDir, ensureDir } from '../utils/temp';
import { config } from '../config';
import { logger } from '../utils/logger';

const preprocessor = new ImagePreprocessor();

export interface RunOCROptions {
  /** Override default preprocessing options for this run. */
  preprocessing?: PreprocessingOptions;
  /** Force OCR even if the PDF has selectable text. */
  forceOCR?: boolean;
}

/**
 * Run the full OCR pipeline on an already-uploaded file.
 * Returns the normalised OCRResult.
 */
export async function runOCR(
  filePath: string,
  memoryId: string,
  userId: string,
  options: RunOCROptions = {},
): Promise<OCRResult> {
  await ensureDir(config.storage.tempDir);

  // ── Phase 1: Validate ────────────────────────────────────────────────────
  const detectedMime = await assertValidFile(filePath);
  const mimeType = detectedMime as SupportedMimeType;

  logger.info('OCR pipeline started', { memoryId, mimeType });

  if (mimeType === 'application/pdf') {
    return runOCROnPDF(filePath, memoryId, userId, mimeType, options);
  }

  return runOCROnImage(filePath, memoryId, userId, mimeType, options);
}

// ── Image branch ──────────────────────────────────────────────────────────────

async function runOCROnImage(
  filePath: string,
  memoryId: string,
  userId: string,
  mimeType: string,
  options: RunOCROptions,
): Promise<OCRResult> {
  const provider = getOCRProvider();

  return withTempDir(async (tempDir) => {
    // ── Phase 2: Preprocess ────────────────────────────────────────────────
    const { outputPath, operations } = await preprocessor.preprocess(
      filePath,
      tempDir,
      options.preprocessing,
    );

    logger.debug('Preprocessing done', { memoryId, operations });

    // ── Phase 3: Extract text ──────────────────────────────────────────────
    const input: OCRInput = {
      filePath: outputPath,
      mimeType,
      inputType: 'IMAGE',
      userId,
      memoryId,
    };

    const raw = await extractTextFromImage(provider, input);

    // ── Phase 4: Normalise ─────────────────────────────────────────────────
    const normalised: OCRResult = {
      ...raw,
      text: normalizeText(raw.text),
      pages: raw.pages ? normalizePages(raw.pages) : undefined,
    };

    logger.info('OCR completed', {
      memoryId,
      provider: provider.name,
      charCount: normalised.text.length,
      language: normalised.language,
    });

    return normalised;
  });
}

// ── PDF branch ────────────────────────────────────────────────────────────────

async function runOCROnPDF(
  filePath: string,
  memoryId: string,
  userId: string,
  mimeType: string,
  options: RunOCROptions,
): Promise<OCRResult> {
  const provider = getOCRProvider();

  // ── Phase 2: Try selectable text extraction ────────────────────────────
  const pdfData = await extractSelectableText(filePath);

  if (pdfData.hasSelectableText && !options.forceOCR) {
    logger.info('PDF has selectable text — skipping OCR', {
      memoryId,
      pages: pdfData.numPages,
      chars: pdfData.text.length,
    });

    const normalisedPages = normalizePages(pdfData.pages);
    const fullText = normalizeText(pdfData.text);

    return {
      text: fullText,
      pages: normalisedPages,
      provider: 'pdf-parse',
      processedAt: new Date(),
    };
  }

  // ── Phase 3: Scanned PDF — render pages, OCR each ─────────────────────
  logger.info('PDF appears scanned — rendering pages for OCR', { memoryId });

  return withTempDir(async (tempDir) => {
    const pageImages = await renderPDFPages(filePath, tempDir, 200);

    const pageResults: OCRPage[] = [];
    let totalConfidence = 0;
    let confidenceCount = 0;
    let combinedLang: string | undefined;

    for (const { pageNumber, imagePath } of pageImages) {
      logger.debug('OCR-ing scanned PDF page', { memoryId, pageNumber });

      const { outputPath } = await preprocessor.preprocess(
        imagePath,
        tempDir,
        { ...options.preprocessing, adaptiveThreshold: true },
      );

      const input: OCRInput = {
        filePath: outputPath,
        mimeType: 'image/png',
        inputType: 'IMAGE',
        userId,
        memoryId,
      };

      const raw = await extractTextFromImage(provider, input);
      const normText = normalizeText(raw.text);

      pageResults.push({ pageNumber, text: normText, confidence: raw.confidence });

      if (raw.confidence != null) {
        totalConfidence += raw.confidence;
        confidenceCount++;
      }
      if (!combinedLang && raw.language) {
        combinedLang = raw.language;
      }
    }

    const combinedText = pageResults.map((p) => p.text).join('\n\n');
    const avgConfidence = confidenceCount > 0 ? totalConfidence / confidenceCount : undefined;

    logger.info('Scanned PDF OCR complete', {
      memoryId,
      pages: pageResults.length,
      charCount: combinedText.length,
      provider: provider.name,
    });

    return {
      text: combinedText,
      language: combinedLang,
      confidence: avgConfidence,
      pages: pageResults,
      provider: provider.name,
      processedAt: new Date(),
    };
  });
}

// ── Retry helper ──────────────────────────────────────────────────────────────

/** Run OCR with bounded retries for transient errors. */
export async function runOCRWithRetry(
  filePath: string,
  memoryId: string,
  userId: string,
  options: RunOCROptions = {},
): Promise<OCRResult> {
  const { maxRetries, retryDelayMs } = config.ocr;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await runOCR(filePath, memoryId, userId, options);
    } catch (err) {
      lastErr = err;
      const isRetryable = err instanceof OCRError && err.retryable;

      if (!isRetryable || attempt > maxRetries) break;

      logger.warn('OCR attempt failed, will retry', {
        memoryId,
        attempt,
        maxRetries,
        error: err instanceof Error ? err.message : String(err),
      });

      await new Promise((res) => setTimeout(res, retryDelayMs * attempt));
    }
  }

  throw lastErr;
}
