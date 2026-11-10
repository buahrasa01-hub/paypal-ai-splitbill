// SplitBill AI — zero-dependency Node server.
// Serves the single-page app and three JSON APIs:
//   GET  /api/config                 -> public config (client id + modes)
//   POST /api/parse                  -> AI/receipt extraction + split input
//   POST /api/paypal/orders          -> create a PayPal (sandbox/demo) order
//   POST /api/paypal/orders/:id/capture
// Secrets (PayPal secret, OpenRouter key) live only in env/key files and
// are never exposed by any endpoint.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBill, readOpenRouterKey } from './lib/ai.js';
import { createOrder, captureOrder, paypalMode } from './lib/paypal.js';
import { toMinor, paypalValue } from './lib/split.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(data);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 200_000) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// Map extracted items (names as assignees) to person indexes and minor units.
function buildSplitInput(extracted, people) {
  const nameToIndex = new Map(people.map((p, i) => [p.trim().toLowerCase(), i]));
  const items = extracted.items.map((it) => ({
    name: it.name,
    qty: it.qty,
    lineTotalMinor: toMinor(it.lineTotal, extracted.currency),
    assignees: (it.assignees || [])
      .map((n) => nameToIndex.get(String(n).trim().toLowerCase()))
      .filter((i) => i !== undefined),
  }));
  return {
    items,
    taxMinor: toMinor(extracted.tax, extracted.currency),
    tipMinor: toMinor(extracted.tip, extracted.currency),
    currency: extracted.currency,
    source: extracted.source,
    model: extracted.model || null,
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  try {
    if (path === '/api/config' && req.method === 'GET') {
      const mode = paypalMode();
      return send(res, 200, {
        paypalMode: mode,
        // The client id is public by design (it ships in every checkout page).
        // In demo mode the UI falls back to PayPal's public "sb" demo id so
        // the button area still renders something meaningful.
        paypalClientId:
          mode === 'sandbox' ? process.env.PAYPAL_CLIENT_ID : 'sb',
        aiEnabled: Boolean(await readOpenRouterKey()) && process.env.AI_DISABLE !== '1',
      });
    }

    if (path === '/api/parse' && req.method === 'POST') {
      const { receiptText, people } = await readJsonBody(req);
      if (!receiptText || typeof receiptText !== 'string' || receiptText.trim().length < 3) {
        return send(res, 400, { error: 'Please paste a bill or receipt first.' });
      }
      const names =
        Array.isArray(people) && people.length > 0
          ? people.map((p) => String(p).trim()).filter(Boolean)
          : [];
      if (names.length === 0) {
        return send(res, 400, { error: 'Please add at least one person.' });
      }
      const extracted = await parseBill(receiptText);
      if (!extracted.items || extracted.items.length === 0) {
        return send(res, 422, {
          error:
            'No priced items could be found in that text. Try a clearer receipt, or add items manually after splitting.',
          source: extracted.source,
        });
      }
      return send(res, 200, buildSplitInput(extracted, names));
    }

    if (path === '/api/paypal/orders' && req.method === 'POST') {
      const { totalMinor, currency, personName } = await readJsonBody(req);
      if (!Number.isFinite(totalMinor) || totalMinor <= 0 || !currency) {
        return send(res, 400, { error: 'A positive amount and currency are required.' });
      }
      const order = await createOrder({
        value: paypalValue(totalMinor, currency),
        currency: String(currency).toUpperCase(),
        description: `SplitBill AI — ${personName || 'a friend'}'s share of the bill`,
      });
      return send(res, 200, order);
    }

    const captureMatch = path.match(/^\/api\/paypal\/orders\/([\w-]+)\/capture$/);
    if (captureMatch && req.method === 'POST') {
      const result = await captureOrder(captureMatch[1]);
      return send(res, 200, result);
    }

    if (path.startsWith('/api/')) {
      return send(res, 404, { error: 'Unknown API route.' });
    }

    // Static files: public/ plus the shared split-math module.
    let filePath;
    if (path === '/' || path === '/index.html') {
      filePath = join(ROOT, 'public', 'index.html');
    } else if (path === '/lib/split.js') {
      filePath = join(ROOT, 'lib', 'split.js');
    } else {
      const safe = normalize(path).replace(/^(\.\.[/\\])+/, '');
      filePath = join(ROOT, 'public', safe);
    }
    const data = await readFile(filePath);
    return send(res, 200, data, MIME[extname(filePath)] || 'application/octet-stream');
  } catch (err) {
    if (err && err.code === 'ENOENT') return send(res, 404, 'Not found', 'text/plain');
    console.error('Request failed:', err?.message || err);
    return send(res, 500, { error: 'Something went wrong on the server. Please try again.' });
  }
});

server.listen(PORT, () => {
  const mode = paypalMode();
  console.log(`SplitBill AI running at http://localhost:${PORT}`);
  console.log(`PayPal mode: ${mode}${mode === 'demo' ? ' (set PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET for real sandbox checkout)' : ''}`);
});
