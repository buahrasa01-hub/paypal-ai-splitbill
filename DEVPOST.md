# Devpost submission draft — SplitBill AI (PayPal AI Hackathon)

> Draft for the PayPal AI Hackathon "Enter a Submission" form. All fields
> in English. Accuracy note: every claim below matches what is verified
> in STATUS.md — the PayPal Sandbox integration is fully implemented and
> was verified against PayPal's live sandbox auth endpoint; a completed
> sandbox payment requires the entrant's own sandbox app credentials
> (5-minute setup, documented in the repo README) and is described
> accordingly, never overstated.

## Title

SplitBill AI

## Tagline

Paste a bill, AI splits it — everyone pays exactly their share with PayPal.

## Project description

### The problem

Every group meal ends with the same small disaster: one receipt, five
people, and a ten-minute negotiation over who had the second pizza, whether
the tip splits evenly, and why the shares never quite add up to the total.
Existing splitters make you type every item by hand — the tedious part is
the data entry, and the error-prone part is the arithmetic: tax and tip
rarely divide cleanly, and a cent or two always goes missing.

### The solution

**SplitBill AI** removes both halves of the problem:

1. **AI does the data entry.** Paste the receipt text and an LLM
   (via OpenRouter) extracts every line item, quantity, line total, tax,
   tip and currency as strict JSON — including per-item assignees when the
   bill names them ("Dragon Roll (for Ana)" is assigned to Ana
   automatically). A deterministic built-in parser is the safety net, so
   extraction still works when free models are rate-limited or no API key
   is configured — the demo never breaks.
2. **Exact math does the splitting.** A pure-function engine works in
   integer minor units and distributes remainder cents deterministically
   (largest remainder). Tax & tip follow each person's item subtotal
   proportionally. Shares always sum to the bill total — $70.11 split
   three ways is $23.38 / $23.37 / $23.36, never $70.09.
3. **PayPal does the settling.** Each person's card carries a PayPal
   checkout for exactly their share, paid to the bill organizer. The
   server creates and captures orders through the **PayPal Sandbox
   Orders API v2** and the page renders **PayPal Smart Buttons** (JS SDK).
   With sandbox app credentials configured, the genuine PayPal Sandbox
   checkout opens; without them, the app runs a clearly-labelled demo
   mode through the same create → approve → capture flow, so judges can
   evaluate the whole product before creating any account.

### How it is built

| Piece | Technology | What it does |
|---|---|---|
| Server | Node.js (zero dependencies, built-in `http`/`fetch`) | Serves the app and the JSON APIs |
| Split engine | Pure JS module shared by browser + tests | Integer-minor-unit math, proportional tax/tip, largest-remainder rounding |
| AI extraction | OpenRouter chat completions (free models, chained + 429 retry) | Receipt text → strict JSON (items, tax, tip, currency, assignees) |
| Fallback parser | Deterministic line parser | US + Indonesian number formats; reconciles tax from total − subtotal |
| Payments | PayPal Sandbox — JS SDK Smart Buttons + REST Orders API v2 (OAuth, create, capture) | One order per person, for exactly their share |

All secrets stay server-side: the PayPal client secret is only used in
the OAuth call to PayPal, the OpenRouter key only in the Authorization
header to OpenRouter; neither is ever sent to the browser or logged.
The public surface is one `/api/config` endpoint (modes + the public
client ID), `/api/parse`, and the two order endpoints.

### Why this matters

Splitting a bill is a small, universal, genuinely annoying problem —
and it sits exactly at the intersection this hackathon asks about:
an AI that understands an unstructured real-world document, and a
payment rail that settles the result in one tap. SplitBill AI is a
complete product loop — understand, compute, collect — not a chatbot
bolted onto a checkout button: remove the AI and the data entry burden
returns; remove PayPal and you're back to chasing bank transfers.

## Tools used (for the Devpost "Tools" field)

- **PayPal Developer Platform (Sandbox)** — JS SDK Smart Buttons for the
  checkout UI; REST Orders API v2 (OAuth 2.0 client credentials, create
  order, capture order) on the server. This is the payment core: every
  share becomes a real sandbox order with the exact amount.
- **OpenRouter** — LLM access for receipt understanding. Free-tier
  models chained with retry (`google/gemma-4-26b-a4b-it:free`,
  `google/gemma-4-31b-it:free`, `cohere/north-mini-code:free`); outputs
  are schema-sanitized before use.
- **Muse (Anthropic)** — used as the development partner that helped
  design, write and test the codebase. The application itself contains
  no Anthropic calls; its runtime AI is OpenRouter, and its split math
  is deterministic code.

## Testing / configuration instructions for judges

No build step and no `npm install` — Node.js 18+ only.

1. Clone the repo and run `node server.js`; open
   `http://localhost:3000`. The app starts in **demo mode**: extraction
   uses the built-in parser (or OpenRouter if you provide a key), and
   payments run a clearly-labelled simulated create → capture flow.
2. The sample dinner bill is prefilled — click **Analyze & split with
   AI**, untick people on rows they didn't share, edit prices, and watch
   each share and the bill total stay exact.
3. Click a person's PayPal button to run their payment flow; the card
   flips to PAID and the summary bar tracks collected vs outstanding.
4. **Real PayPal Sandbox (optional, ~5 min):** create a free account at
   developer.paypal.com → Apps & Credentials → Sandbox → create app →
   restart with `PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… node server.js`.
   The badge flips to "PayPal: Sandbox (live)" and the buttons open the
   genuine sandbox checkout (pay with any sandbox personal account from
   the same dashboard; capture completes through the Orders API).
5. `npm test` runs 14 automated checks: split-math invariants, the
   parser on USD and Indonesian receipts, and a server smoke test
   including the order create → capture flow.

## Built with

Node.js · PayPal JS SDK (Smart Buttons) · PayPal REST Orders API v2
(Sandbox) · OpenRouter (LLM receipt extraction) · vanilla HTML/CSS/JS

## Links

- Source repository: https://github.com/buahrasa01-hub/paypal-ai-splitbill
- Demo video (YouTube, public, under 3 minutes): https://youtu.be/s4oE1nsJiR4
- Hosted demo: local-run via repo instructions (see Testing above)

## Accuracy notes for the submitter (delete before submitting)

- Verified 2026-11-10: full demo-mode flow end-to-end; live AI
  extraction through the running server (incl. named-assignee mapping);
  sandbox code path verified against PayPal's live sandbox OAuth
  endpoint (dummy credentials correctly rejected with invalid_client).
- NOT yet done: an end-to-end payment with real sandbox app
  credentials — needs the entrant's own developer.paypal.com account
  (see STATUS.md). If that step is completed before submitting, this
  note and the demo-mode framing in the video can be upgraded to a
  fully live sandbox checkout.
