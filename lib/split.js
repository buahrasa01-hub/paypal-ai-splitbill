// SplitBill AI — pure split math, shared by the browser UI and the Node tests.
// All money is handled in integer minor units (cents for USD, whole rupiah
// for IDR) so shares always add up exactly to the bill total.

export const CURRENCY_EXPONENT = {
  USD: 2, EUR: 2, GBP: 2, SGD: 2, AUD: 2, CAD: 2, HKD: 2, NZD: 2, CHF: 2,
  IDR: 0, JPY: 0, KRW: 0, VND: 0,
};

export function exponentFor(currency) {
  return CURRENCY_EXPONENT[(currency || 'USD').toUpperCase()] ?? 2;
}

// Convert a major-unit decimal amount (e.g. 12.50) to integer minor units.
export function toMinor(amount, currency) {
  const exp = exponentFor(currency);
  return Math.round(Number(amount || 0) * 10 ** exp);
}

// Convert integer minor units back to a major-unit number.
export function toMajor(minor, currency) {
  const exp = exponentFor(currency);
  return Number(minor || 0) / 10 ** exp;
}

// Format minor units for display, e.g. 1694 USD -> "$16.94".
export function formatMoney(minor, currency) {
  const cur = (currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: cur,
      minimumFractionDigits: exponentFor(cur),
      maximumFractionDigits: exponentFor(cur),
    }).format(toMajor(minor, cur));
  } catch {
    return `${cur} ${toMajor(minor, cur)}`;
  }
}

// Format minor units as the decimal string PayPal's Orders API expects.
export function paypalValue(minor, currency) {
  const cur = (currency || 'USD').toUpperCase();
  const exp = exponentFor(cur);
  return toMajor(minor, cur).toFixed(exp);
}

// Split `total` (integer minor units) across `weights` using the
// largest-remainder method, so the parts sum EXACTLY to `total`.
// Zero-weight entries receive zero unless every weight is zero, in which
// case the total is split equally.
export function distribute(total, weights) {
  const n = weights.length;
  if (n === 0) return [];
  const safeTotal = Math.round(total);
  const sumW = weights.reduce((a, b) => a + Math.max(0, b), 0);
  const w = sumW > 0 ? weights.map((x) => Math.max(0, x)) : weights.map(() => 1);
  const wSum = w.reduce((a, b) => a + b, 0);
  const exact = w.map((x) => (safeTotal * x) / wSum);
  const parts = exact.map((x) => Math.floor(x));
  let remainder = safeTotal - parts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; remainder > 0; k = (k + 1) % n) {
    parts[order[k].i] += 1;
    remainder -= 1;
  }
  return parts;
}

// Compute per-person shares.
// items: [{ name, qty, lineTotalMinor, assignees: [personIndex, ...] }]
// An empty assignees list means "shared by everyone".
// tax/tip are split in proportion to each person's item subtotal.
// Returns { people: [{ itemsMinor, taxMinor, tipMinor, totalMinor }], grandTotalMinor }
export function computeSplit({ items, peopleCount, taxMinor = 0, tipMinor = 0 }) {
  const people = Array.from({ length: peopleCount }, () => ({
    itemsMinor: 0,
    taxMinor: 0,
    tipMinor: 0,
    totalMinor: 0,
  }));
  for (const item of items) {
    const assignees =
      item.assignees && item.assignees.length > 0
        ? [...new Set(item.assignees)].filter((i) => i >= 0 && i < peopleCount)
        : people.map((_, i) => i);
    if (assignees.length === 0) continue;
    const shares = distribute(item.lineTotalMinor, assignees.map(() => 1));
    assignees.forEach((personIdx, k) => {
      people[personIdx].itemsMinor += shares[k];
    });
  }
  const subtotals = people.map((p) => p.itemsMinor);
  const taxShares = distribute(Math.round(taxMinor), subtotals);
  const tipShares = distribute(Math.round(tipMinor), subtotals);
  people.forEach((p, i) => {
    p.taxMinor = taxShares[i] || 0;
    p.tipMinor = tipShares[i] || 0;
    p.totalMinor = p.itemsMinor + p.taxMinor + p.tipMinor;
  });
  const itemsTotal = items.reduce((a, it) => a + it.lineTotalMinor, 0);
  return {
    people,
    grandTotalMinor: itemsTotal + Math.round(taxMinor) + Math.round(tipMinor),
  };
}
