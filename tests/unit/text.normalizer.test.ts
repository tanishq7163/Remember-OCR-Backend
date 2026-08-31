import { normalizeText } from '../../src/normalization/text.normalizer';

describe('TextNormalizer', () => {
  it('collapses excessive whitespace', () => {
    expect(normalizeText('hello   world')).toBe('hello world');
  });

  it('collapses 3+ blank lines to 2', () => {
    const input = 'a\n\n\n\n\nb';
    expect(normalizeText(input)).toBe('a\n\nb');
  });

  it('preserves Indian rupee prices', () => {
    const text = 'MacBook Air M4\n₹94,990\nApple India\nAvailable now';
    const result = normalizeText(text);
    expect(result).toContain('₹94,990');
  });

  it('preserves URLs', () => {
    const url = 'https://www.apple.com/in/shop/buy-mac/macbook-air';
    expect(normalizeText(`Visit ${url} for more`)).toContain(url);
  });

  it('preserves phone numbers', () => {
    expect(normalizeText('Call: +91 98765 43210')).toContain('+91 98765 43210');
  });

  it('preserves dates', () => {
    expect(normalizeText('Invoice date: 15/08/2024')).toContain('15/08/2024');
  });

  it('strips null bytes', () => {
    expect(normalizeText('hello\x00world')).toBe('helloworld');
  });

  it('normalises Unicode to NFC', () => {
    // é as NFC vs NFD
    const nfd = 'e\u0301'; // e + combining acute accent
    const nfc = '\u00e9'; // é precomposed
    expect(normalizeText(nfd)).toBe(nfc);
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeText('   hello   ')).toBe('hello');
  });

  it('preserves meaningful single newlines', () => {
    const input = 'Store: Apple\nDate: 15/08/2024\nTotal: ₹94,990';
    const result = normalizeText(input);
    expect(result.split('\n').length).toBe(3);
  });

  it('handles empty string', () => {
    expect(normalizeText('')).toBe('');
  });

  it('handles Hinglish mixed-language text', () => {
    const input = '₹500 ka recharge karna hai   tomorrow';
    const result = normalizeText(input);
    expect(result).toContain('₹500');
    expect(result).toContain('recharge karna hai');
    expect(result).toContain('tomorrow');
  });

  it('normalises CRLF line endings', () => {
    const result = normalizeText('line1\r\nline2\r\nline3');
    expect(result).toBe('line1\nline2\nline3');
  });
});
