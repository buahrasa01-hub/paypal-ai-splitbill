# SplitBill AI

**Paste a bill. AI splits it. Everyone pays their share with PayPal.**

SplitBill AI turns the worst part of any group dinner — the end — into three
clicks. Paste the receipt text, and an AI extracts every line item, quantity,
tax and tip. Assign items to the people who actually had them (or share
everything), and SplitBill computes each person's exact share: their items
plus proportional tax & tip, in integer minor units so the shares always add
up to the bill total **to the cent**. Each person then pays exactly their
share to the organizer with a PayPal Sandbox checkout button.

**Demo video (2:30, public):** https://youtu.be/s4oE1nsJiR4 — the full
flow end to end, recorded in the app's clearly-labelled demo mode.

Built for the **PayPal AI Hackathon** (Devpost). It meaningfully uses both
required ingredients:

- **PayPal** — the server creates and captures real orders through the
  **PayPal Sandbox Orders API v2** (OAuth + `POST /v2/checkout/orders` +
  capture), and the page renders **PayPal Smart Buttons** (JS SDK) — one per
  person, for exactly that person's share.
- **AI** — receipt understanding is done by an LLM via **OpenRouter**
  (free-tier models, chained with retry), returning strict JSON: items,
  quantities, line totals, tax, tip, currency, and per-item assignees when
  the bill names them ("Dragon Roll (for Ana)"). A built-in **deterministic
  parser** is the safety net: if every model is rate-limited or no key is
  configured, extraction still works and the demo never breaks.

## Quick start (zero config — demo mode)

Requires Node.js 18+ (uses only built-in modules — **no `npm install` needed**).

```bash
git clone https://github.com/buahrasa01-hub/paypal-ai-splitbill.git
cd paypal-ai-splitbill
node server.js
# open http://localhost:3000
```

With zero configuration the app runs in **demo mode**: AI extraction uses a
local OpenRouter key if one is present (see below), otherwise the built-in
parser; payments run through the same create → approve → capture flow
against simulated server-side orders, clearly labelled **DEMO** everywhere.
Nothing is faked silently — the UI badge always shows which mode is live.

Run the test suite (split math, parser, full server smoke test):

```bash
npm test
```

## Enable the real PayPal Sandbox checkout (~5 minutes)

1. Go to [developer.paypal.com](https://developer.paypal.com), sign in (or
   create a free account), and open **Apps & Credentials → Sandbox**.
2. Create an app (or use the default sandbox app) and copy its
   **Client ID** and **Secret**.
3. Start the server with them:

```bash
PAYPAL_CLIENT_ID=your-sandbox-client-id \
PAYPAL_CLIENT_SECRET=your-sandbox-secret \
node server.js
```

The header badge flips to **"PayPal: Sandbox (live)"**, the demo banner
disappears, and each person's card renders a real PayPal Smart Button.
Clicking it opens the genuine PayPal Sandbox checkout; pay with any
sandbox personal account from your developer dashboard, and the payment is
captured through the Orders API — the card flips to **PAID ✓** with the
capture ID.

> The client secret is only ever used server-side in the OAuth call to
> PayPal. It is never sent to the browser, logged, or returned by any API.
> Only the client ID (public by design in checkout pages) reaches the page.

## Enable AI extraction

The server reads the OpenRouter key from, in order:

1. `OPENROUTER_API_KEY` environment variable, or
2. a key file: `OPENROUTER_KEY_FILE` (default `~/.openrouter/key`).

Get a free key at [openrouter.ai](https://openrouter.ai). The app chains
free models (`google/gemma-4-26b-a4b-it:free`,
`google/gemma-4-31b-it:free`, `cohere/north-mini-code:free`) with a retry on
rate limits, validates the JSON strictly, and falls back to the built-in
parser if all models are unavailable. Set `AI_DISABLE=1` to force parser
mode.

## How it works

| Piece | File | What it does |
|---|---|---|
| Server | `server.js` | Zero-dependency Node HTTP server + JSON APIs |
| Split math | `lib/split.js` | Pure functions; integer minor units, largest-remainder distribution so totals are always exact; shared verbatim by the browser and the tests |
| AI extraction | `lib/ai.js` | OpenRouter chat completions → strict JSON, sanitized; model chain + 429 retry; parser fallback |
| Parser | `lib/parser.js` | Deterministic receipt parser (US + Indonesian number formats, tax/tip/subtotal/total reconciliation) |
| PayPal | `lib/paypal.js` | Sandbox OAuth, Orders v2 create/capture; demo-mode order store behind the same interface |
| UI | `public/` | Single-page app: bill input → editable split table → per-person PayPal buttons |

Minor details that matter:

- **Currencies** — splitting works for any currency the extractor returns;
  zero-decimal currencies (IDR, JPY, KRW, VND) are handled with the correct
  exponent. PayPal buttons activate for PayPal-supported currencies; for
  others (e.g. IDR) the shares are still computed and the UI explains the
  settlement options.
- **Fairness** — tax & tip follow each person's item subtotal
  proportionally; per-item remainder cents are distributed deterministically
  (largest remainder), so a group of three splitting $70.11 sees shares like
  $23.38 / $23.37 / $23.36 — never a missing cent.

## Testing instructions for judges

1. `node server.js`, open `http://localhost:3000` — the sample dinner bill
   is prefilled. Click **Analyze & split with AI**.
2. Untick people on rows they didn't share; watch totals update live; the
   bill total never drifts.
3. Pay a share: in demo mode the button runs the simulated flow and marks
   the card **PAID (DEMO)**; with sandbox credentials configured (above)
   the real PayPal Sandbox checkout opens instead.
4. Try an Indonesian receipt, e.g. lines like `Nasi Goreng 45.000` — the
   parser and the AI both read the thousand separators correctly.
5. `npm test` — 14 checks: split invariants, parser (USD + IDR), and a
   server smoke test including the order create → capture flow.

## License

MIT — see [LICENSE](LICENSE).
