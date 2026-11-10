// SplitBill AI — test suite (node test/run-tests.mjs or npm test).
// Covers: split math invariants, the deterministic receipt parser
// (USD + IDR formats), and a full server smoke test in demo mode
// (AI disabled, no PayPal credentials) including the order flow.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { computeSplit, distribute, toMinor } from '../lib/split.js';
import { parseReceipt, parseAmount } from '../lib/parser.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// ---------- split math ----------
check('distribute splits evenly with exact sum', () => {
  assert.deepEqual(distribute(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(distribute(0, [1, 1]), [0, 0]);
  assert.deepEqual(distribute(7, [0, 0]), [4, 3]); // all-zero weights -> equal
});

check('computeSplit: shared + personal items, proportional tax', () => {
  const r = computeSplit({
    items: [
      { name: 'Pizza', qty: 1, lineTotalMinor: 1000, assignees: [0, 1] },
      { name: 'Salad', qty: 1, lineTotalMinor: 600, assignees: [] },
    ],
    peopleCount: 3,
    taxMinor: 160,
    tipMinor: 0,
  });
  assert.deepEqual(r.people.map((p) => p.itemsMinor), [700, 700, 200]);
  assert.deepEqual(r.people.map((p) => p.taxMinor), [70, 70, 20]);
  assert.deepEqual(r.people.map((p) => p.totalMinor), [770, 770, 220]);
  assert.equal(r.grandTotalMinor, 1760);
});

check('computeSplit: rounding keeps the grand total exact', () => {
  const r = computeSplit({
    items: [{ name: 'Odd', qty: 1, lineTotalMinor: 101, assignees: [] }],
    peopleCount: 3,
    taxMinor: 10,
    tipMinor: 7,
  });
  const sum = r.people.reduce((a, p) => a + p.totalMinor, 0);
  assert.equal(sum, 118);
  assert.equal(r.grandTotalMinor, 118);
});

check('computeSplit: one person pays a solo item entirely', () => {
  const r = computeSplit({
    items: [{ name: 'Steak', qty: 1, lineTotalMinor: 2500, assignees: [2] }],
    peopleCount: 3,
    taxMinor: 200,
    tipMinor: 0,
  });
  assert.deepEqual(r.people.map((p) => p.totalMinor), [0, 0, 2700]);
});

check('toMinor respects currency exponent', () => {
  assert.equal(toMinor(12.5, 'USD'), 1250);
  assert.equal(toMinor(45000, 'IDR'), 45000);
  assert.equal(toMinor(9.99, 'JPY'), 10);
});

// ---------- parser ----------
check('parseAmount handles US and Indonesian formats', () => {
  assert.equal(parseAmount('1,234.56', 'USD'), 1234.56);
  assert.equal(parseAmount('45.000', 'IDR'), 45000);
  assert.equal(parseAmount('45.500,00', 'IDR'), 45500);
  assert.equal(parseAmount('9.50', 'USD'), 9.5);
});

const USD_RECEIPT = `Mario's Trattoria
2x Margherita Pizza 31.00
1x Caesar Salad 9.50
1x Garlic Bread 6.00
3x Iced Tea 10.50
Subtotal 57.00
Tax 4.56
Tip 8.55
Total 70.11`;

check('parser: USD receipt extracts items, tax, tip', () => {
  const r = parseReceipt(USD_RECEIPT);
  assert.equal(r.currency, 'USD');
  assert.equal(r.items.length, 4);
  assert.deepEqual(
    r.items.map((i) => [i.name, i.qty, i.lineTotal]),
    [
      ['Margherita Pizza', 2, 31],
      ['Caesar Salad', 1, 9.5],
      ['Garlic Bread', 1, 6],
      ['Iced Tea', 3, 10.5],
    ],
  );
  assert.equal(r.tax, 4.56);
  assert.equal(r.tip, 8.55);
  assert.equal(r.subtotal, 57);
  assert.equal(r.total, 70.11);
});

check('parser: IDR receipt reads thousand separators', () => {
  const r = parseReceipt(`Warung Sederhana
Nasi Goreng 45.000
Es Teh Manis 8.000
Ayam Goreng 25.000
Total 78.000`);
  assert.equal(r.currency, 'IDR');
  assert.deepEqual(r.items.map((i) => i.lineTotal), [45000, 8000, 25000]);
  assert.equal(r.total, 78000);
});

check('parser: missing tax is derived from total - subtotal', () => {
  const r = parseReceipt(`Cafe
Sandwich 10.00
Coffee 4.00
Subtotal 14.00
Total 15.12`);
  assert.equal(r.tax, 1.12);
});

// ---------- server smoke test (demo mode) ----------
const PORT = 3217;
const base = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, PORT: String(PORT), AI_DISABLE: '1' };
delete env.PAYPAL_CLIENT_ID;
delete env.PAYPAL_CLIENT_SECRET;
delete env.OPENROUTER_API_KEY;
env.OPENROUTER_KEY_FILE = '/nonexistent/key'; // force parser-only mode

const server = spawn('node', ['server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${base}/api/config`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server did not start. Log:\n${serverLog}`);
}

try {
  await waitForServer();

  const page = await (await fetch(`${base}/`)).text();
  assert.ok(page.includes('SplitBill'), 'home page should mention SplitBill');
  console.log('  ✓ server: home page loads');
  passed += 1;

  const config = await (await fetch(`${base}/api/config`)).json();
  assert.equal(config.paypalMode, 'demo');
  assert.equal(config.aiEnabled, false);
  console.log('  ✓ server: /api/config reports demo mode without credentials');
  passed += 1;

  const splitRes = await fetch(`${base}/api/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ receiptText: USD_RECEIPT, people: ['Bayu', 'Ana', 'Budi'] }),
  });
  const split = await splitRes.json();
  assert.equal(splitRes.status, 200);
  assert.equal(split.source, 'parser');
  assert.equal(split.items.length, 4);
  assert.equal(split.taxMinor, 456);
  assert.equal(split.tipMinor, 855);
  const perPerson = computeSplit({
    items: split.items,
    peopleCount: 3,
    taxMinor: split.taxMinor,
    tipMinor: split.tipMinor,
  });
  // Each line item's remainder cents are distributed deterministically
  // (largest remainder), so equal shares land within a cent or two of
  // $23.37 while the total stays exact.
  assert.deepEqual(perPerson.people.map((p) => p.totalMinor), [2338, 2337, 2336]);
  assert.equal(perPerson.grandTotalMinor, 7011);
  console.log('  ✓ server: /api/parse splits the sample bill exactly (total $70.11 preserved)');
  passed += 1;

  const badOrder = await fetch(`${base}/api/paypal/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ totalMinor: -5, currency: 'USD' }),
  });
  assert.equal(badOrder.status, 400);
  console.log('  ✓ server: negative order amount is rejected');
  passed += 1;

  const orderRes = await fetch(`${base}/api/paypal/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ totalMinor: 2337, currency: 'USD', personName: 'Ana' }),
  });
  const order = await orderRes.json();
  assert.equal(order.mode, 'demo');
  assert.ok(order.id.startsWith('DEMO-'));
  const capRes = await fetch(`${base}/api/paypal/orders/${order.id}/capture`, { method: 'POST' });
  const capture = await capRes.json();
  assert.equal(capture.status, 'COMPLETED');
  console.log('  ✓ server: demo order create → capture completes');
  passed += 1;
} finally {
  server.kill('SIGTERM');
}

console.log(`\nAll ${passed} checks passed.`);
