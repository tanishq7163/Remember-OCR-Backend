import { Router } from 'express';
import { authMiddleware } from './middleware/auth.middleware';
import { uploadMiddleware } from './middleware/upload.middleware';
import { rateLimitMiddleware } from './middleware/rate-limit.middleware';
import {
  uploadAndStartOCR,
  getOCRResult,
  retryOCR,
  getOCRHandoff,
} from './ocr.controller';

export const ocrRouter = Router();

// All OCR routes require authentication
ocrRouter.use(authMiddleware);
ocrRouter.use(rateLimitMiddleware);

// POST /api/memories/:id/ocr  — upload file and trigger OCR
ocrRouter.post('/:id/ocr', uploadMiddleware.single('file'), (req, res) => {
  void uploadAndStartOCR(req, res);
});

// GET /api/memories/:id/ocr  — poll OCR status and result
ocrRouter.get('/:id/ocr', (req, res) => {
  void getOCRResult(req, res);
});

// POST /api/memories/:id/ocr/retry  — retry a failed OCR
ocrRouter.post('/:id/ocr/retry', (req, res) => {
  void retryOCR(req, res);
});

// GET /api/memories/:id/ocr/handoff  — minimal payload for LLM service
ocrRouter.get('/:id/ocr/handoff', (req, res) => {
  void getOCRHandoff(req, res);
});
