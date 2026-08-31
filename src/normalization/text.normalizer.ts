/**
 * TEXT NORMALISATION
 *
 * Cleans raw OCR output without interpreting meaning.
 * Preserves: prices, currencies, dates, phone numbers, URLs, meaningful line breaks.
 * Removes: OCR artefacts, duplicate whitespace, garbled control characters.
 *
 * This layer sits between OCR → LLM. It does NOT correct words,
 * does NOT classify content, does NOT use an LLM.
 */

// Patterns for content that must be preserved as-is
const URL_RE = /https?:\/\/[^\s]+/g;
const PHONE_RE = /(?:\+?\d[\d\s\-().]{6,}\d)/g;
const PRICE_RE = /[₹$€£¥₩]\s?\d[\d,.]*/g;
const DATE_RE =
  /\b(?:\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})\b/g;

export function normalizeText(raw: string): string {
  if (!raw) return '';

  let text = raw;

  // 1. Unicode normalise to NFC (canonical composition)
  text = text.normalize('NFC');

  // 2. Strip null bytes and other dangerous control characters
  //    Keep: \n (LF), \r (CR), \t (TAB), standard Unicode
  text = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');

  // 3. Normalise line endings to LF
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 4. Remove trailing whitespace on each line
  text = text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');

  // 5. Collapse runs of 3+ blank lines to exactly 2 (paragraph break)
  text = text.replace(/\n{3,}/g, '\n\n');

  // 6. Collapse runs of 2+ spaces to one (but not inside URLs / prices)
  //    Strategy: protect known patterns, collapse, restore
  const protected_: string[] = [];
  let idx = 0;

  const protect = (s: string): string => {
    const token = `\x01P${idx++}\x01`;
    protected_.push(s);
    return token;
  };

  text = text
    .replace(URL_RE, protect)
    .replace(PHONE_RE, protect)
    .replace(PRICE_RE, protect)
    .replace(DATE_RE, protect);

  // Collapse multiple spaces to one
  text = text.replace(/[ \t]{2,}/g, ' ');

  // Restore protected tokens
  text = text.replace(/\x01P(\d+)\x01/g, (_, i) => protected_[parseInt(i, 10)] ?? '');

  // 7. Trim leading/trailing whitespace
  text = text.trim();

  return text;
}

/** Normalise the text field of every OCR page in place. */
export function normalizePages(
  pages: Array<{ pageNumber: number; text: string; confidence?: number }>,
): Array<{ pageNumber: number; text: string; confidence?: number }> {
  return pages.map((p) => ({ ...p, text: normalizeText(p.text) }));
}
