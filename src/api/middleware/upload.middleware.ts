import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../config';
import { Request } from 'express';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, config.storage.uploadDir);
  },
  filename: (_req, file, cb) => {
    // Never use the client-supplied filename — generate a safe UUID name.
    const ext = path.extname(file.originalname).replace(/[^a-z0-9.]/gi, '').slice(0, 10);
    cb(null, `${uuidv4()}${ext ? '.' + ext : ''}`);
  },
});

/** Multer only accepts files whose client Content-Type looks plausible.
 *  The true MIME check happens in file.validator.ts via magic bytes. */
function fileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
): void {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}`));
  }
}

export const uploadMiddleware = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.storage.maxFileSizeBytes,
    files: 1,
  },
});
