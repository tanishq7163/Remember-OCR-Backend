// All shared types for the OCR pipeline.
// These are pure data contracts — no business logic here.

export type OCRInputType = 'IMAGE' | 'PDF';

export interface OCRInput {
  filePath: string;
  mimeType: string;
  inputType: OCRInputType;
  userId: string;
  memoryId: string;
}

export interface OCRPage {
  pageNumber: number;
  text: string;
  confidence?: number;
}

export interface OCRResult {
  text: string;
  language?: string;
  confidence?: number;
  pages?: OCRPage[];
  provider: string;
  providerVersion?: string;
  processedAt: Date;
}

// What the OCR service hands off to the LLM service. Nothing more.
export interface OCRHandoff {
  memoryId: string;
  sourceType: OCRInputType;
  extractedText: string;
  language?: string;
  pages?: OCRPage[];
}

export type OCRStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';

export interface StoredOCRResult extends OCRResult {
  id: string;
  memoryId: string;
  status: OCRStatus;
  errorMessage?: string;
  retryCount: number;
}

// MIME types that the pipeline accepts.
export type SupportedMimeType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'application/pdf';

export const SUPPORTED_MIME_TYPES: SupportedMimeType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_IMAGE_DIMENSION_PX = 8_000;
export const MIN_IMAGE_DIMENSION_PX = 32;

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  detectedMimeType?: string;
}

// ── Preprocessing ────────────────────────────────────────────────────────────

export interface PreprocessingOptions {
  /** Fix EXIF orientation. Default: true */
  autoOrient?: boolean;
  /** CLAHE adaptive contrast. Default: true */
  normalizeContrast?: boolean;
  /** Unsharp-mask text sharpening. Default: true */
  sharpen?: boolean;
  /** Median-filter denoising. Default: true */
  denoise?: boolean;
  /** Convert to grayscale before OCR. Default: true */
  grayscale?: boolean;
  /** Upscale if smallest dimension is below this. Default: 800 */
  upscaleMinDimension?: number;
  /** Downscale if largest dimension exceeds this. Default: 4096 */
  maxDimension?: number;
  /** Auto-detect and correct text skew. Default: true */
  deskew?: boolean;
  /** Local-mean adaptive binarisation (good for receipts/bills). Default: false */
  adaptiveThreshold?: boolean;
}

export interface PreprocessingResult {
  outputPath: string;
  wasPreprocessed: boolean;
  operations: string[];
  originalWidth: number;
  originalHeight: number;
  outputWidth: number;
  outputHeight: number;
}

// ── Error codes ───────────────────────────────────────────────────────────────

export enum OCRErrorCode {
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  INVALID_MIME_TYPE = 'INVALID_MIME_TYPE',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  CORRUPT_FILE = 'CORRUPT_FILE',
  IMAGE_TOO_SMALL = 'IMAGE_TOO_SMALL',
  IMAGE_TOO_LARGE = 'IMAGE_TOO_LARGE',
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  PROVIDER_RATE_LIMIT = 'PROVIDER_RATE_LIMIT',
  OCR_TIMEOUT = 'OCR_TIMEOUT',
  EMPTY_RESULT = 'EMPTY_RESULT',
  SCANNED_PDF_UNAVAILABLE = 'SCANNED_PDF_UNAVAILABLE',
  PREPROCESSING_FAILED = 'PREPROCESSING_FAILED',
  UNKNOWN = 'UNKNOWN',
}

export class OCRError extends Error {
  constructor(
    message: string,
    public readonly code: OCRErrorCode,
    /** Whether a retry might succeed */
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'OCRError';
  }
}
