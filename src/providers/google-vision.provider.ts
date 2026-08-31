import { ImageAnnotatorClient } from '@google-cloud/vision';
import fs from 'fs';
import path from 'path';
import { OCRProvider } from './OCRProvider.interface';
import { OCRInput, OCRResult, OCRPage, OCRError, OCRErrorCode } from '../types/ocr.types';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Indian-language hints sent to Google Vision so the model weights
 * recognition toward those scripts when they appear in mixed content.
 */
const LANGUAGE_HINTS = ['en', 'hi', 'bn', 'mr', 'ta', 'te', 'kn', 'gu', 'pa', 'ml'];

export class GoogleVisionProvider implements OCRProvider {
  readonly name = 'google_vision';
  private client: ImageAnnotatorClient;

  constructor() {
    const credPath = config.googleVision.credentialsPath;
    if (credPath && fs.existsSync(path.resolve(credPath))) {
      this.client = new ImageAnnotatorClient({
        keyFilename: path.resolve(credPath),
        projectId: config.googleVision.projectId || undefined,
      });
    } else {
      // Fall back to Application Default Credentials
      this.client = new ImageAnnotatorClient();
    }
  }

  async extractText(input: OCRInput): Promise<OCRResult> {
    const { filePath, mimeType, inputType } = input;

    if (inputType === 'PDF') {
      // PDF via async GCS batch is the production approach.
      // For local MVP we convert pages outside and OCR each image individually.
      throw new OCRError(
        'GoogleVisionProvider: call extractText per rendered page, not on raw PDFs directly.',
        OCRErrorCode.INVALID_MIME_TYPE,
        false,
      );
    }

    const imageBytes = await fs.promises.readFile(filePath);
    const content = imageBytes.toString('base64');

    logger.debug('GoogleVision: sending request', {
      memoryId: input.memoryId,
      mimeType,
      sizeBytes: imageBytes.length,
    });

    let response;
    try {
      [response] = await this.client.documentTextDetection({
        image: { content },
        imageContext: { languageHints: LANGUAGE_HINTS },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);

      // Rate-limit detection
      if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
        throw new OCRError(
          `Google Vision rate limit: ${msg}`,
          OCRErrorCode.PROVIDER_RATE_LIMIT,
          true,
        );
      }
      // Network / unavailable
      if (msg.includes('UNAVAILABLE') || msg.includes('503')) {
        throw new OCRError(
          `Google Vision unavailable: ${msg}`,
          OCRErrorCode.PROVIDER_UNAVAILABLE,
          true,
        );
      }

      throw new OCRError(
        `Google Vision error: ${msg}`,
        OCRErrorCode.UNKNOWN,
        false,
      );
    }

    if (response.error) {
      throw new OCRError(
        `Google Vision API error: ${response.error.message}`,
        OCRErrorCode.PROVIDER_UNAVAILABLE,
        false,
      );
    }

    const annotation = response.fullTextAnnotation;
    const rawText = annotation?.text ?? '';

    if (!rawText.trim()) {
      return {
        text: '',
        confidence: 1.0,
        provider: this.name,
        processedAt: new Date(),
      };
    }

    // Aggregate per-page confidence
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pages: OCRPage[] = ((annotation?.pages ?? []) as any[]).map((p: any, idx: number) => {
      const words: any[] = (p.blocks ?? [])
        .flatMap((b: any) => b.paragraphs ?? [])
        .flatMap((para: any) => para.words ?? []);

      const pageConf: number =
        words.reduce((acc: number, w: any) => acc + (w.confidence ?? 0), 0) /
        Math.max(1, words.length);

      const pageText: string = (p.blocks ?? [])
        .flatMap((b: any) => b.paragraphs ?? [])
        .map((para: any) =>
          (para.words ?? [])
            .map((w: any) => (w.symbols ?? []).map((s: any) => s.text ?? '').join(''))
            .join(' '),
        )
        .join('\n');

      return { pageNumber: idx + 1, text: pageText, confidence: pageConf };
    });

    // Detected locale (first page locale wins)
    const detectedLang: string | undefined =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (annotation?.pages as any)?.[0]?.property?.detectedLanguages?.[0]?.languageCode ?? undefined;

    // Overall confidence = mean word confidence
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allWords: any[] = ((annotation?.pages ?? []) as any[])
      .flatMap((p: any) => p.blocks ?? [])
      .flatMap((b: any) => b.paragraphs ?? [])
      .flatMap((para: any) => para.words ?? []);

    const confidence: number | undefined =
      allWords.length > 0
        ? allWords.reduce((acc: number, w: any) => acc + (w.confidence ?? 0), 0) / allWords.length
        : undefined;

    return {
      text: rawText,
      language: detectedLang,
      confidence,
      pages: pages.length > 0 ? pages : undefined,
      provider: this.name,
      processedAt: new Date(),
    };
  }
}
