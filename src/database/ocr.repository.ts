import { PrismaClient } from '@prisma/client';

type OcrStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
import { OCRResult, OCRPage, StoredOCRResult } from '../types/ocr.types';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

export class OcrRepository {
  /** Create a Memory row and a pending OcrResult row. */
  async createMemory(data: {
    id: string;
    userId: string;
    originalPath: string;
    mimeType: string;
    fileSize: number;
    contentHash: string;
  }): Promise<void> {
    await prisma.memory.create({
      data: {
        ...data,
        ocrResult: {
          create: {
            provider: '',
            status: 'PENDING',
          },
        },
      },
    });
  }

  async setStatus(
    memoryId: string,
    status: OcrStatus,
    errorMessage?: string,
  ): Promise<void> {
    await prisma.ocrResult.update({
      where: { memoryId },
      data: {
        status,
        errorMessage: errorMessage ?? null,
        updatedAt: new Date(),
      },
    });
  }

  async saveOCRResult(
    memoryId: string,
    result: OCRResult,
    status: OcrStatus,
  ): Promise<void> {
    const pages = result.pages ?? [];

    await prisma.ocrResult.update({
      where: { memoryId },
      data: {
        status,
        extractedText: result.text,
        language: result.language ?? null,
        confidence: result.confidence ?? null,
        provider: result.provider,
        providerVersion: result.providerVersion ?? null,
        processedAt: result.processedAt,
        errorMessage: null,
        pages: {
          deleteMany: {},
          createMany: {
            data: pages.map((p: OCRPage) => ({
              pageNumber: p.pageNumber,
              text: p.text,
              confidence: p.confidence ?? null,
            })),
          },
        },
      },
    });
  }

  async getOCRResult(memoryId: string): Promise<StoredOCRResult | null> {
    const row = await prisma.ocrResult.findUnique({
      where: { memoryId },
      include: { pages: { orderBy: { pageNumber: 'asc' } } },
    });

    if (!row) return null;

    return {
      id: row.id,
      memoryId: row.memoryId,
      status: row.status as StoredOCRResult['status'],
      text: row.extractedText ?? '',
      language: row.language ?? undefined,
      confidence: row.confidence ?? undefined,
      pages: row.pages.map((p) => ({
        pageNumber: p.pageNumber,
        text: p.text,
        confidence: p.confidence ?? undefined,
      })),
      provider: row.provider,
      providerVersion: row.providerVersion ?? undefined,
      processedAt: row.processedAt ?? new Date(),
      errorMessage: row.errorMessage ?? undefined,
      retryCount: row.retryCount,
    };
  }

  async incrementRetryCount(memoryId: string): Promise<number> {
    const updated = await prisma.ocrResult.update({
      where: { memoryId },
      data: { retryCount: { increment: 1 } },
    });
    return updated.retryCount;
  }

  /** Find a completed OCR result for the same user + file hash (dedup). */
  async findCompletedByHash(
    userId: string,
    contentHash: string,
  ): Promise<StoredOCRResult | null> {
    const memory = await prisma.memory.findFirst({
      where: { userId, contentHash, ocrResult: { status: 'COMPLETED' } },
      include: {
        ocrResult: { include: { pages: { orderBy: { pageNumber: 'asc' } } } },
      },
    });

    if (!memory?.ocrResult) return null;

    const row = memory.ocrResult;
    return {
      id: row.id,
      memoryId: row.memoryId,
      status: row.status as StoredOCRResult['status'],
      text: row.extractedText ?? '',
      language: row.language ?? undefined,
      confidence: row.confidence ?? undefined,
      pages: row.pages.map((p) => ({
        pageNumber: p.pageNumber,
        text: p.text,
        confidence: p.confidence ?? undefined,
      })),
      provider: row.provider,
      providerVersion: row.providerVersion ?? undefined,
      processedAt: row.processedAt ?? new Date(),
      retryCount: row.retryCount,
    };
  }

  /** Copy an existing completed OCR result to a new memory (dedup). */
  async copyOCRResult(source: StoredOCRResult, targetMemoryId: string): Promise<void> {
    await prisma.ocrResult.update({
      where: { memoryId: targetMemoryId },
      data: {
        status: 'COMPLETED',
        extractedText: source.text,
        language: source.language ?? null,
        confidence: source.confidence ?? null,
        provider: source.provider,
        providerVersion: source.providerVersion ?? null,
        processedAt: source.processedAt,
        pages: {
          deleteMany: {},
          createMany: {
            data: (source.pages ?? []).map((p) => ({
              pageNumber: p.pageNumber,
              text: p.text,
              confidence: p.confidence ?? null,
            })),
          },
        },
      },
    });
  }

  async getMemory(memoryId: string, userId: string) {
    return prisma.memory.findFirst({ where: { id: memoryId, userId } });
  }

  async disconnect(): Promise<void> {
    await prisma.$disconnect();
  }
}
