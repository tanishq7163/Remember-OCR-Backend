import crypto from 'crypto';
import fs from 'fs';

/** Compute SHA-256 of the raw file bytes. Used for dedup checks. */
export function computeFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/** Read the first N bytes of a file — used for magic-byte MIME detection. */
export async function readFileHead(filePath: string, bytes = 16): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const buf = Buffer.alloc(bytes);
    const fd = fs.open(filePath, 'r', (err, handle) => {
      if (err) return reject(err);
      fs.read(handle, buf, 0, bytes, 0, (readErr, bytesRead) => {
        fs.close(handle, () => {
          if (readErr) return reject(readErr);
          resolve(buf.subarray(0, bytesRead));
        });
      });
    });
    void fd;
  });
}
