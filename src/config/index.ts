import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function optionalInt(name: string, fallback: number): number {
  const v = process.env[name];
  return v ? parseInt(v, 10) : fallback;
}

export const config = {
  port: optionalInt('PORT', 3001),
  nodeEnv: optional('NODE_ENV', 'development'),
  isProduction: process.env['NODE_ENV'] === 'production',

  storage: {
    uploadDir: path.resolve(optional('UPLOAD_DIR', './uploads')),
    tempDir: path.resolve(optional('TEMP_DIR', './tmp')),
    maxFileSizeBytes: optionalInt('MAX_FILE_SIZE_MB', 50) * 1024 * 1024,
  },

  ocr: {
    provider: optional('OCR_PROVIDER', 'google_vision') as
      | 'google_vision'
      | 'azure_vision'
      | 'aws_textract',
    maxRetries: optionalInt('OCR_MAX_RETRIES', 3),
    retryDelayMs: optionalInt('OCR_RETRY_DELAY_MS', 2000),
    timeoutMs: optionalInt('OCR_TIMEOUT_MS', 60_000),
  },

  googleVision: {
    credentialsPath: optional('GOOGLE_APPLICATION_CREDENTIALS', ''),
    projectId: optional('GOOGLE_CLOUD_PROJECT_ID', ''),
  },

  azureVision: {
    endpoint: optional('AZURE_VISION_ENDPOINT', ''),
    key: optional('AZURE_VISION_KEY', ''),
  },

  aws: {
    region: optional('AWS_REGION', 'us-east-1'),
    accessKeyId: optional('AWS_ACCESS_KEY_ID', ''),
    secretAccessKey: optional('AWS_SECRET_ACCESS_KEY', ''),
  },

  auth: {
    jwtSecret: optional('JWT_SECRET', 'NhE5QhhFvvsA5DTMCOvJVoF7uawXt43xHZMZSXcgXNjKCnP6FvWOXQCTSQszOoM4WMjcEgkNzr+wzcoQxALg0A=='),
  },

  rateLimit: {
    windowMs: optionalInt('RATE_LIMIT_WINDOW_MS', 60_000),
    maxRequests: optionalInt('RATE_LIMIT_MAX_REQUESTS', 30),
  },
} as const;
