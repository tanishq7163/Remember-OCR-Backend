import { config } from '../config';
import { OCRProvider } from './OCRProvider.interface';
import { GoogleVisionProvider } from './google-vision.provider';
import { AzureVisionProvider } from './azure-vision.provider';
import { AwsTextractProvider } from './aws-textract.provider';

let _instance: OCRProvider | null = null;

/** Returns the singleton OCR provider selected by OCR_PROVIDER in .env. */
export function getOCRProvider(): OCRProvider {
  if (_instance) return _instance;

  switch (config.ocr.provider) {
    case 'google_vision':
      _instance = new GoogleVisionProvider();
      break;
    case 'azure_vision':
      _instance = new AzureVisionProvider();
      break;
    case 'aws_textract':
      _instance = new AwsTextractProvider();
      break;
    default:
      _instance = new GoogleVisionProvider();
  }

  return _instance;
}

/** Replace the active provider — useful in tests. */
export function setOCRProvider(provider: OCRProvider): void {
  _instance = provider;
}
