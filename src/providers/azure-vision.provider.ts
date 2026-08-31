/**
 * Azure AI Vision provider — stub implementation.
 *
 * To implement: install @azure/ai-vision-image-analysis and configure
 * AZURE_VISION_ENDPOINT + AZURE_VISION_KEY in .env.
 */
import { OCRProvider } from './OCRProvider.interface';
import { OCRInput, OCRResult, OCRError, OCRErrorCode } from '../types/ocr.types';

export class AzureVisionProvider implements OCRProvider {
  readonly name = 'azure_vision';

  async extractText(_input: OCRInput): Promise<OCRResult> {
    throw new OCRError(
      'Azure Vision provider not yet implemented. Set OCR_PROVIDER=google_vision in .env.',
      OCRErrorCode.PROVIDER_UNAVAILABLE,
      false,
    );
  }
}
