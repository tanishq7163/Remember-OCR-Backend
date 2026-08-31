# Test Fixtures

Put real test images here for manual / E2E evaluation.

## Required for §19 full evaluation

| File | Description |
|------|-------------|
| `clean_screenshot.png` | A crisp screenshot with clear text |
| `blurry_screenshot.jpg` | A blurry or low-quality screenshot |
| `receipt.jpg` | A shop receipt with items, prices, totals |
| `electricity_bill.jpg` | An electricity bill with invoice number |
| `menu.jpg` | A restaurant menu |
| `product.png` | A product screenshot (e.g. Apple India store) |
| `hindi_text.jpg` | An image with pure Hindi text |
| `hinglish.jpg` | Mixed Hindi + English text |
| `long_doc.pdf` | A multi-page selectable-text PDF |
| `scanned.pdf` | A scanned (image-based) PDF |
| `no_text.jpg` | A photo with no text |
| `rotated.jpg` | A photo taken at an angle |
| `lowres.jpg` | A very low-resolution image (< 300px) |
| `url.png` | Screenshot containing a URL |
| `phone.png` | Screenshot containing a phone number |

**Never commit real user receipts or bills — use synthetic samples.**

## Ground truth

For quantitative evaluation (§20), create a `ground_truth/` subfolder:

```
tests/fixtures/ground_truth/
  receipt.txt        ← expected extracted text
  electricity_bill.txt
  ...
```

Then run your evaluation script against the OCR output and compare character-error rate (CER).
