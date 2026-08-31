import { OCRInput, OCRResult } from '../types/ocr.types';

/**
 * All OCR providers implement this interface.
 * The pipeline only speaks to this contract — never a concrete vendor.
 */
export interface OCRProvider {
  /** Human-readable name used for logging and the stored `provider` field. */
  readonly name: string;

  /** Extract text from the given input. Throws OCRError on failure. */
  extractText(input: OCRInput): Promise<OCRResult>;
}
