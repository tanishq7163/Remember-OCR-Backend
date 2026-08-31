/**
 * IMAGE PREPROCESSING PIPELINE
 *
 * Applies a staged pipeline to maximise OCR text-extraction accuracy —
 * the same class of operations used by production AI vision systems:
 *
 *  1. Auto-orient       — fix EXIF rotation
 *  2. Alpha flatten     — composite transparent areas onto white
 *  3. Resize            — upscale low-res, downscale oversized
 *  4. Denoise           — 3×3 median filter (salt-and-pepper noise)
 *  5. Grayscale         — reduce to luminance channel
 *  6. CLAHE             — Contrast Limited Adaptive Histogram Equalisation
 *                         (handles shadows, uneven lighting, reflections)
 *  7. Deskew            — detect text-line angle via projection profiles
 *                         (Otsu binarisation → radon-style row sum variance)
 *  8. Sharpen           — unsharp mask tuned for text edges
 *  9. Adaptive binarise — local-mean thresholding via integral image (opt-in)
 * 10. PNG output        — lossless, full-quality, for OCR ingestion
 *
 * The original uploaded file is NEVER modified.
 */

import sharp from 'sharp';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PreprocessingOptions, PreprocessingResult } from '../types/ocr.types';
import { logger } from '../utils/logger';

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULTS: Required<PreprocessingOptions> = {
  autoOrient: true,
  normalizeContrast: true,
  sharpen: true,
  denoise: true,
  grayscale: true,
  upscaleMinDimension: 800,
  maxDimension: 4096,
  deskew: true,
  adaptiveThreshold: false,
};

/** Max dimension used when downsampling just for skew detection (speed). */
const DESKEW_PROBE_MAX = 600;

/** Search range for skew detection in degrees. */
const SKEW_RANGE_DEG = 15;
const SKEW_STEP_DEG = 0.5;

/** Ignore skew corrections below this threshold (avoid unnecessary rotations). */
const SKEW_IGNORE_THRESHOLD_DEG = 0.5;

// ── Main class ────────────────────────────────────────────────────────────────

export class ImagePreprocessor {
  async preprocess(
    inputPath: string,
    outputDir: string,
    options: PreprocessingOptions = {},
  ): Promise<PreprocessingResult> {
    const opts: Required<PreprocessingOptions> = { ...DEFAULTS, ...options };
    const operations: string[] = [];

    const meta = await sharp(inputPath).metadata();
    const origWidth = meta.width ?? 0;
    const origHeight = meta.height ?? 0;

    // ── Stage 1: Auto-orient ─────────────────────────────────────────────────
    let pipeline = sharp(inputPath);

    if (opts.autoOrient) {
      pipeline = pipeline.rotate(); // reads EXIF Orientation tag
      operations.push('auto-orient');
    }

    // ── Stage 2: Remove alpha channel ────────────────────────────────────────
    // Transparent PNGs would otherwise produce black backgrounds after grayscale.
    if (meta.hasAlpha) {
      pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } });
      operations.push('flatten-alpha');
    }

    // ── Stage 3: Resize ──────────────────────────────────────────────────────
    const smallSide = Math.min(origWidth, origHeight);
    const largeSide = Math.max(origWidth, origHeight);

    if (smallSide > 0 && smallSide < opts.upscaleMinDimension) {
      // Upscale low-res so OCR engines have enough pixels per glyph.
      const scale = opts.upscaleMinDimension / smallSide;
      pipeline = pipeline.resize(
        Math.round(origWidth * scale),
        Math.round(origHeight * scale),
        { fit: 'fill', kernel: sharp.kernel.lanczos3 },
      );
      operations.push(`upscale-${Math.round(scale * 100)}pct`);
    } else if (largeSide > opts.maxDimension) {
      // Downscale oversized images to keep OCR provider costs reasonable.
      pipeline = pipeline.resize(opts.maxDimension, opts.maxDimension, {
        fit: 'inside',
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3,
      });
      operations.push(`downscale-max${opts.maxDimension}`);
    }

    // ── Stage 4: Denoise ─────────────────────────────────────────────────────
    if (opts.denoise) {
      // Median filter: eliminates salt-and-pepper noise without blurring edges.
      pipeline = pipeline.median(3);
      operations.push('denoise-median3');
    }

    // ── Stage 5: Grayscale ───────────────────────────────────────────────────
    if (opts.grayscale) {
      pipeline = pipeline.grayscale();
      operations.push('grayscale');
    }

    // ── Stage 6: CLAHE ───────────────────────────────────────────────────────
    // Contrast Limited Adaptive Histogram Equalisation.
    // Divides the image into tiles and equalises each tile's histogram
    // independently, then blends. Handles shadows, uneven lighting, reflections.
    if (opts.normalizeContrast) {
      pipeline = pipeline.clahe({ width: 8, height: 8, maxSlope: 3 });
      operations.push('clahe-8x8');
    }

    // ── Stage 7: Deskew ──────────────────────────────────────────────────────
    if (opts.deskew) {
      const skewAngle = await this.detectSkewAngle(pipeline.clone(), origWidth, origHeight);
      if (Math.abs(skewAngle) > SKEW_IGNORE_THRESHOLD_DEG) {
        pipeline = pipeline.rotate(-skewAngle, {
          background: { r: 255, g: 255, b: 255 },
        });
        operations.push(`deskew-${skewAngle.toFixed(1)}deg`);
      }
    }

    // ── Stage 8: Sharpen ─────────────────────────────────────────────────────
    if (opts.sharpen) {
      // Unsharp mask tuned for text: amplify sharp edges (character strokes)
      // without introducing halos in flat regions.
      pipeline = pipeline.sharpen({ sigma: 1.5, m1: 0.5, m2: 3.0, x1: 2.0, y2: 10.0, y3: 20.0 });
      operations.push('sharpen-usm');
    }

    // ── Stage 9: Adaptive binarisation ───────────────────────────────────────
    if (opts.adaptiveThreshold) {
      const { data: rawData, info } = await pipeline
        .clone()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const binarised = this.adaptiveThreshold(rawData, info.width, info.height, info.channels);
      pipeline = sharp(binarised, {
        raw: { width: info.width, height: info.height, channels: info.channels },
      });
      operations.push('adaptive-threshold');
    }

    // ── Stage 10: Output ─────────────────────────────────────────────────────
    const outputPath = path.join(outputDir, `pre_${uuidv4()}.png`);
    const outputInfo = await pipeline
      .png({ compressionLevel: 1 }) // fast compression; size doesn't matter for temp files
      .toFile(outputPath);

    logger.debug('Preprocessing complete', {
      inputPath: path.basename(inputPath),
      outputPath: path.basename(outputPath),
      operations,
      dimensions: `${outputInfo.width}×${outputInfo.height}`,
    });

    return {
      outputPath,
      wasPreprocessed: operations.length > 0,
      operations,
      originalWidth: origWidth,
      originalHeight: origHeight,
      outputWidth: outputInfo.width,
      outputHeight: outputInfo.height,
    };
  }

  // ── Skew detection ──────────────────────────────────────────────────────────

  /**
   * Detect the dominant text-line angle using horizontal projection profiles.
   *
   * Algorithm:
   *  - Downsample to at most DESKEW_PROBE_MAX px for speed
   *  - Binarise with Otsu's threshold
   *  - For each candidate angle θ, project dark pixels onto rotated horizontal axis
   *    and measure row-sum variance (text lines → high variance)
   *  - The angle with maximum variance = text orientation
   */
  private async detectSkewAngle(
    pipeline: ReturnType<typeof sharp>,
    origWidth: number,
    origHeight: number,
  ): Promise<number> {
    // Downsample for speed
    const scale = Math.min(1, DESKEW_PROBE_MAX / Math.max(origWidth, origHeight, 1));
    const pw = Math.max(1, Math.round(origWidth * scale));
    const ph = Math.max(1, Math.round(origHeight * scale));

    const { data, info } = await pipeline
      .grayscale()
      .resize(pw, ph, { fit: 'fill', kernel: sharp.kernel.nearest })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = data as unknown as Uint8Array;
    const w = info.width;
    const h = info.height;

    // Otsu binarisation threshold
    const threshold = this.otsuThreshold(pixels, w * h);

    let bestAngle = 0;
    let maxVariance = -1;

    for (let deg = -SKEW_RANGE_DEG; deg <= SKEW_RANGE_DEG; deg += SKEW_STEP_DEG) {
      const variance = this.projectionVariance(pixels, w, h, deg, threshold);
      if (variance > maxVariance) {
        maxVariance = variance;
        bestAngle = deg;
      }
    }

    return bestAngle;
  }

  /** Otsu's method — returns the binarisation threshold that maximises inter-class variance. */
  private otsuThreshold(pixels: Uint8Array, n: number): number {
    const hist = new Int32Array(256);
    for (let i = 0; i < n; i++) hist[pixels[i]]++;

    let totalSum = 0;
    for (let i = 0; i < 256; i++) totalSum += i * hist[i];

    let sumB = 0;
    let wB = 0;
    let best = 0;
    let bestVar = 0;

    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = n - wB;
      if (wF === 0) break;

      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (totalSum - sumB) / wF;
      const v = wB * wF * (mB - mF) ** 2;
      if (v > bestVar) {
        bestVar = v;
        best = t;
      }
    }

    return best;
  }

  /**
   * Project dark pixels onto a rotated horizontal axis and return the
   * variance of row sums. O(w × h) per angle (no pixel copying).
   */
  private projectionVariance(
    pixels: Uint8Array,
    w: number,
    h: number,
    angleDeg: number,
    threshold: number,
  ): number {
    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const newH = Math.ceil(Math.abs(h * cos) + Math.abs(w * sin)) + 2;
    const offset = Math.floor((newH - h) / 2);

    const rowSums = new Float64Array(newH);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (pixels[y * w + x] < threshold) {
          const ry = Math.round(y * cos - x * sin) + offset;
          if (ry >= 0 && ry < newH) rowSums[ry]++;
        }
      }
    }

    let sum = 0;
    for (let i = 0; i < newH; i++) sum += rowSums[i];
    const mean = sum / newH;

    let variance = 0;
    for (let i = 0; i < newH; i++) variance += (rowSums[i] - mean) ** 2;
    return variance / newH;
  }

  // ── Adaptive binarisation ───────────────────────────────────────────────────

  /**
   * Local-mean adaptive threshold using an integral image (summed area table).
   * O(w × h) regardless of block size.
   *
   * A pixel is set to 0 (black) if its value is below the local mean − C,
   * otherwise 255 (white).
   */
  private adaptiveThreshold(
    pixels: Buffer,
    width: number,
    height: number,
    channels: number,
    blockHalf = 15,
    C = 10,
  ): Buffer {
    const n = width * height;
    const integral = new Float64Array((width + 1) * (height + 1));

    // Build summed area table on the first (luminance) channel
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = pixels[(y * width + x) * channels];
        integral[(y + 1) * (width + 1) + (x + 1)] =
          v +
          integral[y * (width + 1) + (x + 1)] +
          integral[(y + 1) * (width + 1) + x] -
          integral[y * (width + 1) + x];
      }
    }

    const out = Buffer.allocUnsafe(n * channels);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const x1 = Math.max(0, x - blockHalf);
        const y1 = Math.max(0, y - blockHalf);
        const x2 = Math.min(width - 1, x + blockHalf);
        const y2 = Math.min(height - 1, y + blockHalf);

        const area = (x2 - x1 + 1) * (y2 - y1 + 1);
        const localSum =
          integral[(y2 + 1) * (width + 1) + (x2 + 1)] -
          integral[y1 * (width + 1) + (x2 + 1)] -
          integral[(y2 + 1) * (width + 1) + x1] +
          integral[y1 * (width + 1) + x1];

        const localMean = localSum / area;
        const pixVal = pixels[(y * width + x) * channels];
        const outVal = pixVal < localMean - C ? 0 : 255;

        for (let c = 0; c < channels; c++) {
          out[(y * width + x) * channels + c] = outVal;
        }
      }
    }

    return out;
  }
}
