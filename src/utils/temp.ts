import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { logger } from './logger';

/** Create a named temp directory scoped to a job and clean it up afterwards. */
export async function withTempDir<T>(
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = path.join(config.storage.tempDir, `ocr_${uuidv4()}`);
  await fs.mkdir(dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch((err) => {
      logger.warn('Failed to clean up temp dir', { dir, err: String(err) });
    });
  }
}

/** Ensure a directory exists. */
export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}
