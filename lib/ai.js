// SplitBill AI — AI receipt extraction via OpenRouter.
// The API key is read from the OPENROUTER_API_KEY environment variable,
// or from a key file (OPENROUTER_KEY_FILE, default ~/.openrouter/key).
// The key is only ever used in the Authorization header of the outbound
// request — it is never logged, returned, or stored.

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseReceipt } from './parser.js';

// Free models, tried in order. Verified live on 2026-11-10:
// gemma-4-26b and cohere/north-mini-code both answered with perfect
// structured JSON; gemma-4-31b was rate-limited at that moment. The
// models sit in different provider pools, so chaining them (plus one
// short retry on a 429) routes around the free tier's bursty limits.
export const AI_MODELS = [
  'google/gemma-4-26b-a4b-it:free',
  'google/gemma-4-31b-it:free',
  'cohere/north-mini-code:free',
];

export async function readOpenRouterKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  const file = process.env.OPENROUTER_KEY_FILE || join(homedir(), '.openrouter', 'key');
  try {
    const key = (await readFile(file, 'utf8')).trim();
    return key || null;
  } catch {
    return null;
  }
}

const SYSTEM_PROMPT = `You extract structured data from restaurant bills and receipts.
Reply with ONLY a single valid JSON object, no markdown fences, no commentary.
Schema:
{"items":[{"name":string,"qty":number,"lineTotal":number,"assignees":[string]}],"tax":number,"tip":number,"currency":string}
Rules:
- lineTotal is the full amount printed for that line (qty multiplied already).
- Numbers are plain decimals in the bill's currency major unit. On Indonesian bills "45.000" means 45000 and the currency is "IDR".
- assignees lists the people the line belongs to ONLY if the text names them (e.g. "for Ana:"); otherwise use [].
- tax and tip are 0 if not printed. Do not invent items. Do not include subtotal/total lines as items.
- currency is an ISO code like "USD", "EUR", "IDR", "SGD".`;

function sanitizeExtraction(data) {
  if (!data || !Array.isArray(data.items)) return null;
  const items = [];
  for (const it of data.items) {
    const name = String(it?.name || '').trim();
    const lineTotal = Number(it?.lineTotal);
    if (!name || !Number.isFinite(lineTotal) || lineTotal < 0) continue;
    items.push({
      name,
      qty: Math.max(1, Math.round(Number(it?.qty) || 1)),
      lineTotal,
      assignees: Array.isArray(it?.assignees)
        ? it.assignees.map((s) => String(s).trim()).filter(Boolean)
        : [],
    });
  }
  if (items.length === 0) return null;
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
  const currency = /^[A-Za-z]{3}$/.test(String(data.currency || ''))
    ? String(data.currency).toUpperCase()
    : 'USD';
  return { items, tax: num(data.tax), tip: num(data.tip), currency };
}

export async function extractWithAI(receiptText, fetchImpl = fetch) {
  const key = await readOpenRouterKey();
  if (!key || process.env.AI_DISABLE === '1') return null;
  for (const model of AI_MODELS) {
    // One retry per model: the free pools rate-limit in bursts (HTTP 429)
    // and usually clear within a few seconds.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            'X-Title': 'SplitBill AI (PayPal AI Hackathon)',
          },
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: 1200,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: `Bill text:\n${receiptText}` },
            ],
          }),
          signal: AbortSignal.timeout(30000),
        });
        if (res.status === 429 && attempt === 0) {
          await new Promise((r) => setTimeout(r, 3500));
          continue;
        }
        if (!res.ok) break;
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content) break;
        const jsonText = content.replace(/```json|```/g, '').trim();
        const clean = sanitizeExtraction(JSON.parse(jsonText));
        if (clean) return { ...clean, source: 'ai', model };
        break;
      } catch {
        break; // Next model, then the parser fallback.
      }
    }
  }
  return null;
}

// Full parse pipeline: AI first, deterministic parser as the safety net,
// so a demo never breaks because a free model is rate-limited.
export async function parseBill(receiptText) {
  const ai = await extractWithAI(receiptText);
  if (ai) return ai;
  const parsed = parseReceipt(receiptText);
  return { ...parsed, source: 'parser', model: null };
}
