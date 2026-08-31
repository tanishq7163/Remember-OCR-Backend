/**
 * AWS Textract provider — stub implementation.
 *
 * To implement: install @aws-sdk/client-textract and configure
 * AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY in .env.
 */
import { OCRProvider } from './OCRProvider.interface';
import { OCRInput, OCRResult, OCRError, OCRErrorCode } from '../types/ocr.types';

export class AwsTextractProvider implements OCRProvider {
  readonly name = 'aws_textract';

  async extractText(_input: OCRInput): Promise<OCRResult> {
    throw new OCRError(
      'AWS Textract provider not yet implemented. Set OCR_PROVIDER=google_vision in .env.',
      OCRErrorCode.PROVIDER_UNAVAILABLE,
      false,
    );
  }
}
