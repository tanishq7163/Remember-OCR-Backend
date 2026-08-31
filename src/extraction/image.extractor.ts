/**
 * Image OCR extractor.
 * Runs the preprocessed image through the configured OCR provider.
 */

import { OCRInput, OCRResult } from '../types/ocr.types';
import { OCRProvider } from '../providers/OCRProvider.interface';

export async function extractTextFromImage(
  provider: OCRProvider,
  input: OCRInput,
): Promise<OCRResult> {
  return provider.extractText(input);
}
