import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { OcrRepository } from '../database/ocr.repository';
import { enqueueOCRJob } from '../jobs/ocr.job';
import { computeFileHash } from '../utils/hash';
import { AuthenticatedRequest } from './middleware/auth.middleware';
import { logger } from '../utils/logger';
import { config } from '../config';

const repo = new OcrRepository();

// ── POST /api/memories/:id/ocr ────────────────────────────────────────────────
// Upload a file and trigger async OCR.

export async function uploadAndStartOCR(req: Request, res: Response): Promise<void> {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.userId;
  const memoryId = req.params['id'] ?? uuidv4();

  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded.' });
    return;
  }

  const { path: uploadedPath, mimetype, size } = req.file;

  // Move file into user-scoped subdirectory to enforce isolation
  const userDir = path.join(config.storage.uploadDir, userId);
  await fs.mkdir(userDir, { recursive: true });
  const finalPath = path.join(userDir, path.basename(uploadedPath));
  await fs.rename(uploadedPath, finalPath);

  let contentHash: string;
  try {
    contentHash = await computeFileHash(finalPath);
  } catch {
    contentHash = uuidv4(); // fallback — dedup won't work but OCR will
  }

  try {
    await repo.createMemory({
      id: memoryId,
      userId,
      originalPath: finalPath,
      mimeType: mimetype,
      fileSize: size,
      contentHash,
    });
  } catch (err) {
    logger.error('Failed to create memory record', { memoryId, err: String(err) });
    res.status(500).json({ error: 'Failed to save memory.' });
    return;
  }

  // Return 202 immediately — OCR runs async
  res.status(202).json({
    memoryId,
    status: 'PENDING',
    message: 'File saved. OCR is processing in the background.',
  });

  enqueueOCRJob({ memoryId, userId, filePath: finalPath });
}

// ── GET /api/memories/:id/ocr ─────────────────────────────────────────────────

export async function getOCRResult(req: Request, res: Response): Promise<void> {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.userId;
  const memoryId = req.params['id'];

  if (!memoryId) {
    res.status(400).json({ error: 'Missing memory ID.' });
    return;
  }

  // Ownership check — never return another user's data
  const memory = await repo.getMemory(memoryId, userId);
  if (!memory) {
    res.status(404).json({ error: 'Memory not found.' });
    return;
  }

  const result = await repo.getOCRResult(memoryId);
  if (!result) {
    res.status(404).json({ error: 'OCR result not found.' });
    return;
  }

  res.json(result);
}

// ── POST /api/memories/:id/ocr/retry ─────────────────────────────────────────

export async function retryOCR(req: Request, res: Response): Promise<void> {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.userId;
  const memoryId = req.params['id'];

  if (!memoryId) {
    res.status(400).json({ error: 'Missing memory ID.' });
    return;
  }

  const memory = await repo.getMemory(memoryId, userId);
  if (!memory) {
    res.status(404).json({ error: 'Memory not found.' });
    return;
  }

  const current = await repo.getOCRResult(memoryId);
  if (!current) {
    res.status(404).json({ error: 'OCR result not found.' });
    return;
  }

  if (current.status === 'PROCESSING') {
    res.status(409).json({ error: 'OCR is already in progress.' });
    return;
  }

  const retryCount = await repo.incrementRetryCount(memoryId);
  if (retryCount > config.ocr.maxRetries) {
    res.status(429).json({ error: 'Maximum retry attempts reached.' });
    return;
  }

  await repo.setStatus(memoryId, 'PENDING');

  res.status(202).json({
    memoryId,
    status: 'PENDING',
    message: 'OCR retry enqueued.',
    retryCount,
  });

  enqueueOCRJob({ memoryId, userId, filePath: memory.originalPath });
}

// ── GET /api/memories/:id/ocr/handoff ────────────────────────────────────────
// Returns the minimal payload for the LLM understanding engine.

export async function getOCRHandoff(req: Request, res: Response): Promise<void> {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.userId;
  const memoryId = req.params['id'];

  if (!memoryId) {
    res.status(400).json({ error: 'Missing memory ID.' });
    return;
  }

  const memory = await repo.getMemory(memoryId, userId);
  if (!memory) {
    res.status(404).json({ error: 'Memory not found.' });
    return;
  }

  const result = await repo.getOCRResult(memoryId);
  if (!result || result.status !== 'COMPLETED') {
    res.status(409).json({ error: 'OCR is not yet complete.' });
    return;
  }

  const mimeType = memory.mimeType;
  const sourceType = mimeType === 'application/pdf' ? 'PDF' : 'IMAGE';

  res.json({
    memoryId,
    sourceType,
    extractedText: result.text,
    language: result.language,
    pages: result.pages,
  });
}
