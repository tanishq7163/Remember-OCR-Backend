/**
 * Async job processor — no Redis/BullMQ required for MVP.
 *
 * Jobs are fired as non-blocking Node.js microtasks via setImmediate.
 * The API returns 202 Accepted immediately and the OCR runs in the background.
 *
 * Architecture note: to scale, replace the `enqueueOCRJob` body with a
 * BullMQ producer and extract `processOCRJob` into a dedicated worker process.
 */

import { runOCRWithRetry } from '../pipeline/ocr.pipeline';
import { OcrRepository } from '../database/ocr.repository';
import { computeFileHash } from '../utils/hash';
import { OCRError } from '../types/ocr.types';
import { logger } from '../utils/logger';

export interface OCRJobPayload {
  memoryId: string;
  userId: string;
  filePath: string;
}

const repo = new OcrRepository();

export function enqueueOCRJob(payload: OCRJobPayload): void {
  // Non-blocking — the HTTP response is already sent before this runs.
  setImmediate(() => {
    void processOCRJob(payload);
  });
}

async function processOCRJob(payload: OCRJobPayload): Promise<void> {
  const { memoryId, userId, filePath } = payload;

  logger.info('OCR job started', { memoryId });

  // ── Dedup check ──────────────────────────────────────────────────────────
  // If an identical file was already processed by this user, reuse the result.
  let contentHash: string;
  try {
    contentHash = await computeFileHash(filePath);
    const existing = await repo.findCompletedByHash(userId, contentHash);
    if (existing) {
      logger.info('Reusing existing OCR result (dedup)', { memoryId, existingId: existing.id });
      await repo.copyOCRResult(existing, memoryId);
      return;
    }
  } catch (hashErr) {
    logger.warn('Hash check failed, proceeding normally', { memoryId, err: String(hashErr) });
  }

  // ── Mark as PROCESSING ────────────────────────────────────────────────────
  await repo.setStatus(memoryId, 'PROCESSING');

  try {
    const result = await runOCRWithRetry(filePath, memoryId, userId);

    await repo.saveOCRResult(memoryId, result, 'COMPLETED');

    logger.info('OCR job completed', {
      memoryId,
      provider: result.provider,
      charCount: result.text.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof OCRError ? err.code : 'UNKNOWN';

    logger.error('OCR job failed', { memoryId, code, message });

    // The original memory is always preserved — only OCR status changes.
    const status =
      code === 'EMPTY_RESULT' || code === 'SCANNED_PDF_UNAVAILABLE' ? 'PARTIAL' : 'FAILED';

    await repo.setStatus(memoryId, status, message);
  }
}
