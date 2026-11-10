// SplitBill AI — deterministic receipt parser.
// Used as the fallback when the AI extractor is unavailable or returns
// nothing usable, and exercised directly by the test suite. It never
// throws: worst case it returns zero items and the UI asks the user to
// add lines manually.

const TAX_WORDS = /\b(tax|vat|gst|ppn|pajak|service\s*charge|svc)\b/i;
const TIP_WORDS = /\b(tip|gratuity)\b/i;
const SUBTOTAL_WORDS = /\b(sub\s*total|subtotal)\b/i;
const TOTAL_WORDS = /\b(grand\s*total|total\s*due|amount\s*due|balance\s*due|total)\b/i;

// Parse a printed amount into a major-unit number, handling both
// "1,234.56" (US style) and "45.000" / "45.500,00" (Indonesian style).
export function parseAmount(raw, currencyHint) {
  if (raw == null) return NaN;
  let s = String(raw).replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  const idrStyle =
    (currencyHint || '').toUpperCase() === 'IDR' ||
    /\d{1,3}(\.\d{3})+(,\d+)?$/.test(s);
  if (idrStyle) {
    // Dots are thousand separators, comma is the decimal mark.
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    s = s.replace(/,/g, '');
  } else if (/^\d+,\d{1,2}$/.test(s)) {
    s = s.replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export function detectCurrency(text) {
  if (/\bRp\b|IDR/i.test(text)) return 'IDR';
  if (/€|\bEUR\b/i.test(text)) return 'EUR';
  if (/£|\bGBP\b/i.test(text)) return 'GBP';
  if (/\bSGD\b|S\$/i.test(text)) return 'SGD';
  if (/\bJPY\b|¥/i.test(text)) return 'JPY';
  if (/\bAUD\b|A\$/i.test(text)) return 'AUD';
  // Heuristic: amounts like 45.000 / 1.250.500 with no $ sign are treated
  // as Indonesian rupiah formatting (dots as thousand separators).
  if (!/\$/.test(text) && /\d{1,3}(\.\d{3})+\b/.test(text)) return 'IDR';
  return 'USD';
}

// Extract { items: [{name, qty, lineTotal}], tax, tip, subtotal, total,
// currency } from raw receipt text. Amounts are major-unit numbers.
export function parseReceipt(text) {
  const currency = detectCurrency(text || '');
  const result = { items: [], tax: 0, tip: 0, subtotal: null, total: null, currency };
  const priceAtEnd = /([-\d][\d.,\s]*)\s*$/;

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(priceAtEnd);
    if (!m) continue;
    const amount = parseAmount(m[1], currency);
    if (!Number.isFinite(amount)) continue;
    const label = line.slice(0, line.length - m[0].length).trim();

    if (TIP_WORDS.test(label)) { result.tip = amount; continue; }
    if (TAX_WORDS.test(label) && !SUBTOTAL_WORDS.test(label)) { result.tax = amount; continue; }
    if (SUBTOTAL_WORDS.test(label)) { result.subtotal = amount; continue; }
    if (TOTAL_WORDS.test(label)) { result.total = amount; continue; }
    if (!label) continue;

    // Item line: optional "2x " / "2 " quantity prefix.
    let qty = 1;
    let name = label.replace(/[-–—:]+$/, '').trim();
    const qm = name.match(/^(\d+)\s*[x×]\s*(.+)$/i) || name.match(/^(\d+)\s+(.+)$/);
    if (qm) {
      qty = parseInt(qm[1], 10);
      name = qm[2].trim();
    }
    if (!name || amount < 0) continue;
    result.items.push({ name, qty, lineTotal: amount, assignees: [] });
  }

  // Reconcile: derive a missing tax from total - subtotal - tip.
  if (
    result.tax === 0 &&
    result.total != null &&
    result.subtotal != null &&
    result.total > result.subtotal + result.tip
  ) {
    result.tax = Math.round((result.total - result.subtotal - result.tip) * 100) / 100;
  }
  if (result.subtotal == null && result.items.length > 0) {
    result.subtotal =
      Math.round(result.items.reduce((a, it) => a + it.lineTotal, 0) * 100) / 100;
  }
  return result;
}
