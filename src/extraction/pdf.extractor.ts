/**
 * PDF text extraction.
 *
 * Strategy:
 *  1. Attempt direct text extraction (pdf-parse) — works for selectable PDFs.
 *  2. Measure text density. If the PDF contains negligible text, it is likely
 *     a scanned document → caller must render pages to images and OCR them.
 *  3. For scanned rendering: pdf2pic is used (requires Ghostscript on the host).
 *     Install Ghostscript: https://www.ghostscript.com/releases/gsdnld.html
 */

import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import { OCRPage, OCRError, OCRErrorCode } from '../types/ocr.types';
import { logger } from '../utils/logger';

/** Minimum average characters-per-page to treat a PDF as "has selectable text". */
const MIN_CHARS_PER_PAGE = 50;

export interface PDFTextResult {
  /** true = selectable text was found; false = scanned, needs OCR */
  hasSelectableText: boolean;
  text: string;
  pages: OCRPage[];
  numPages: number;
}

export interface PDFPageImage {
  pageNumber: number;
  imagePath: string;
}

// ── Selectable text extraction ────────────────────────────────────────────────

export async function extractSelectableText(pdfPath: string): Promise<PDFTextResult> {
  const dataBuffer = fs.readFileSync(pdfPath);

  let parsed: Awaited<ReturnType<typeof pdfParse>>;
  try {
    parsed = await pdfParse(dataBuffer, {
      // Return page-level text in the `pageRender` callback
      pagerender: (pageData: { getTextContent: () => Promise<{ items: Array<{ str: string }> }> }) =>
        pageData.getTextContent().then((tc) =>
          tc.items.map((item) => item.str).join(' '),
        ),
    });
  } catch (err) {
    throw new OCRError(
      `pdf-parse failed: ${err instanceof Error ? err.message : String(err)}`,
      OCRErrorCode.CORRUPT_FILE,
      false,
    );
  }

  const numPages = parsed.numpages;
  const totalText = parsed.text.trim();
  const avgCharsPerPage = totalText.length / Math.max(1, numPages);

  const hasSelectableText = avgCharsPerPage >= MIN_CHARS_PER_PAGE;

  // Build per-page records from the raw text
  // pdf-parse does not give us page-split text natively in all cases,
  // so we split on the form-feed character it injects between pages.
  const pageTexts = totalText.split('\f');
  const pages: OCRPage[] = pageTexts
    .map((t, i) => ({ pageNumber: i + 1, text: t.trim() }))
    .filter((p) => p.text.length > 0);

  logger.debug('PDF text extraction', {
    file: path.basename(pdfPath),
    numPages,
    avgCharsPerPage: Math.round(avgCharsPerPage),
    hasSelectableText,
  });

  return { hasSelectableText, text: totalText, pages, numPages };
}

// ── Scanned PDF → images ──────────────────────────────────────────────────────

/**
 * Render each page of a scanned PDF to a PNG image.
 * Requires Ghostscript or GraphicsMagick/ImageMagick on the host.
 *
 * Returns an ordered list of { pageNumber, imagePath }.
 */
export async function renderPDFPages(
  pdfPath: string,
  outputDir: string,
  dpi = 200,
): Promise<PDFPageImage[]> {
  // pdf2pic is imported lazily so the app starts without crashing if
  // Ghostscript is not installed — we only fail when actually called.
  let fromPath: typeof import('pdf2pic').fromPath;
  try {
    const pdf2pic = await import('pdf2pic');
    fromPath = pdf2pic.fromPath;
  } catch {
    throw new OCRError(
      'pdf2pic is not installed. Run: npm install pdf2pic',
      OCRErrorCode.SCANNED_PDF_UNAVAILABLE,
      false,
    );
  }

  const converter = fromPath(pdfPath, {
    density: dpi,
    saveFilename: 'page',
    savePath: outputDir,
    format: 'png',
    // A4 at chosen DPI — 8.27 × 11.69 inches
    width: Math.round(8.27 * dpi),
    height: Math.round(11.69 * dpi),
  });

  // Get total page count via text extraction (pdf-parse is fast)
  let numPages: number;
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const parsed = await pdfParse(dataBuffer);
    numPages = parsed.numpages;
  } catch {
    numPages = 0; // fall back to convert-all
  }

  const images: PDFPageImage[] = [];

  if (numPages === 0) {
    // Convert all pages (pdf2pic default)
    const results = await converter.bulk(-1);
    for (const result of results) {
      if (result.path && result.page != null) {
        images.push({ pageNumber: result.page, imagePath: result.path });
      }
    }
  } else {
    for (let p = 1; p <= numPages; p++) {
      try {
        const result = await converter(p, { responseType: 'image' });
        if (result.path) {
          images.push({ pageNumber: p, imagePath: result.path });
        }
      } catch (err) {
        logger.warn('Failed to render PDF page', {
          file: path.basename(pdfPath),
          page: p,
          err: String(err),
        });
      }
    }
  }

  if (images.length === 0) {
    throw new OCRError(
      'Could not render any pages from the scanned PDF. ' +
        'Ensure Ghostscript is installed: https://www.ghostscript.com/',
      OCRErrorCode.SCANNED_PDF_UNAVAILABLE,
      false,
    );
  }

  return images.sort((a, b) => a.pageNumber - b.pageNumber);
}
