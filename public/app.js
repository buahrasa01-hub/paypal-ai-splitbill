// SplitBill AI — browser app.
// Flow: paste bill -> POST /api/parse (AI extraction, parser fallback)
// -> editable item/assignment table -> exact per-person shares (lib/split.js)
// -> each share payable via PayPal (real Sandbox Smart Buttons when the
// server has sandbox credentials, clearly-labelled demo buttons otherwise).

import {
  computeSplit,
  formatMoney,
  toMinor,
  toMajor,
  exponentFor,
} from '/lib/split.js';

const PAYPAL_CURRENCIES = new Set([
  'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'JPY', 'SGD', 'HKD', 'NZD', 'CHF',
  'SEK', 'DKK', 'PLN', 'NOK', 'MXN', 'BRL',
]);

const $ = (sel) => document.querySelector(sel);

const state = {
  config: null,
  people: [],
  currency: 'USD',
  items: [], // { name, qty, lineTotalMinor, assignees: [idx] }
  taxMinor: 0,
  tipMinor: 0,
  paid: {}, // idx -> { mode, captureId }
  sdkLoadedFor: null,
};

async function loadConfig() {
  const res = await fetch('/api/config');
  state.config = await res.json();
  const aiBadge = $('#ai-badge');
  aiBadge.textContent = state.config.aiEnabled ? 'AI: on (OpenRouter)' : 'AI: parser mode';
  aiBadge.classList.add(state.config.aiEnabled ? 'on' : 'demo');
  const ppBadge = $('#paypal-badge');
  if (state.config.paypalMode === 'sandbox') {
    ppBadge.textContent = 'PayPal: Sandbox (live)';
    ppBadge.classList.add('on');
  } else {
    ppBadge.textContent = 'PayPal: demo mode';
    ppBadge.classList.add('demo');
    $('#demo-banner').classList.remove('hidden');
  }
  $('#mode-note').textContent =
    state.config.paypalMode === 'sandbox'
      ? 'Payments run against the real PayPal Sandbox.'
      : 'Payments are simulated until sandbox credentials are configured.';
}

function currentPeople() {
  return $('#people-input')
    .value.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function analyze() {
  const btn = $('#analyze-btn');
  const status = $('#analyze-status');
  const people = currentPeople();
  const receiptText = $('#receipt-input').value;
  if (people.length === 0) {
    status.textContent = 'Please add at least one person.';
    status.classList.add('error');
    return;
  }
  btn.disabled = true;
  status.classList.remove('error');
  status.textContent = 'Reading the bill… (AI first, deterministic parser as safety net)';
  try {
    const res = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiptText, people }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Analysis failed.');
    state.people = people;
    state.currency = data.currency;
    state.items = data.items;
    state.taxMinor = data.taxMinor;
    state.tipMinor = data.tipMinor;
    state.paid = {};
    state.sdkLoadedFor = null;
    $('#source-label').textContent =
      data.source === 'ai' ? `AI (${data.model || 'OpenRouter'})` : 'the built-in parser (AI unavailable)';
    const exp = exponentFor(state.currency);
    const step = exp === 0 ? '1' : '0.01';
    $('#tax-input').step = step;
    $('#tip-input').step = step;
    $('#tax-input').value = toMajor(state.taxMinor, state.currency);
    $('#tip-input').value = toMajor(state.tipMinor, state.currency);
    $('#items-card').classList.remove('hidden');
    $('#shares-card').classList.remove('hidden');
    status.textContent = `Split ready — ${state.items.length} items, ${state.currency}. Adjust assignments below if needed.`;
    renderItems();
    renderShares();
  } catch (err) {
    status.textContent = err.message;
    status.classList.add('error');
  } finally {
    btn.disabled = false;
  }
}

function renderItems() {
  const tbody = $('#items-table tbody');
  tbody.innerHTML = '';
  state.items.forEach((item, itemIdx) => {
    const tr = document.createElement('tr');
    const sharedBy =
      item.assignees && item.assignees.length > 0
        ? new Set(item.assignees)
        : new Set(state.people.map((_, i) => i));
    const checks = state.people
      .map(
        (p, pi) =>
          `<label class="assignee"><input type="checkbox" data-item="${itemIdx}" data-person="${pi}" ${
            sharedBy.has(pi) ? 'checked' : ''
          }/> ${escapeHtml(p)}</label>`,
      )
      .join('');
    tr.innerHTML = `
      <td><input type="text" data-name="${itemIdx}" value="${escapeHtml(item.name)}" /></td>
      <td>${item.qty}</td>
      <td><input type="number" data-price="${itemIdx}" step="${exponentFor(state.currency) === 0 ? '1' : '0.01'}" min="0"
                 value="${toMajor(item.lineTotalMinor, state.currency)}" /></td>
      <td>${checks}</td>
      <td><button class="del-btn" data-del="${itemIdx}" title="Remove item">✕</button></td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('input[type="checkbox"]').forEach((cb) =>
    cb.addEventListener('change', () => {
      const itemIdx = Number(cb.dataset.item);
      const checked = [...tbody.querySelectorAll(`input[data-item="${itemIdx}"]:checked`)].map(
        (c) => Number(c.dataset.person),
      );
      state.items[itemIdx].assignees = checked;
      renderShares();
    }),
  );
  tbody.querySelectorAll('input[data-price]').forEach((inp) =>
    inp.addEventListener('change', () => {
      const itemIdx = Number(inp.dataset.price);
      state.items[itemIdx].lineTotalMinor = toMinor(Number(inp.value || 0), state.currency);
      renderShares();
    }),
  );
  tbody.querySelectorAll('input[data-name]').forEach((inp) =>
    inp.addEventListener('change', () => {
      state.items[Number(inp.dataset.name)].name = inp.value;
    }),
  );
  tbody.querySelectorAll('button[data-del]').forEach((b) =>
    b.addEventListener('click', () => {
      state.items.splice(Number(b.dataset.del), 1);
      renderItems();
      renderShares();
    }),
  );
}

function currentSplit() {
  return computeSplit({
    items: state.items,
    peopleCount: state.people.length,
    taxMinor: state.taxMinor,
    tipMinor: state.tipMinor,
  });
}

function renderShares() {
  const split = currentSplit();
  const collected = Object.keys(state.paid).reduce(
    (a, idx) => a + split.people[Number(idx)].totalMinor,
    0,
  );
  $('#summary-bar').innerHTML = `
    <span>Bill total <b>${formatMoney(split.grandTotalMinor, state.currency)}</b></span>
    <span>Collected <b>${formatMoney(collected, state.currency)}</b></span>
    <span>Outstanding <b>${formatMoney(split.grandTotalMinor - collected, state.currency)}</b></span>`;
  const wrap = $('#people-cards');
  wrap.innerHTML = '';
  split.people.forEach((share, i) => {
    const card = document.createElement('div');
    card.className = 'person-card';
    const paid = state.paid[i];
    card.innerHTML = `
      <h3>${escapeHtml(state.people[i])} ${paid ? `<span class="paid-tag ${paid.mode === 'demo' ? 'demo' : ''}">${paid.mode === 'demo' ? 'PAID (DEMO)' : 'PAID ✓'}</span>` : ''}</h3>
      <div class="amount">${formatMoney(share.totalMinor, state.currency)}</div>
      <div class="breakdown">
        Items ${formatMoney(share.itemsMinor, state.currency)} ·
        Tax ${formatMoney(share.taxMinor, state.currency)} ·
        Tip ${formatMoney(share.tipMinor, state.currency)}
      </div>
      <div class="pay-slot" id="pay-slot-${i}"></div>
      <div class="pay-note" id="pay-note-${i}"></div>`;
    wrap.appendChild(card);
    if (!paid && share.totalMinor > 0) renderPayControl(i, share.totalMinor);
    if (!paid && share.totalMinor === 0) {
      $(`#pay-note-${i}`).textContent = 'Nothing owed for this split.';
    }
    if (paid) {
      $(`#pay-note-${i}`).textContent = `Capture: ${paid.captureId}`;
    }
  });
}

function renderPayControl(personIdx, totalMinor) {
  const slot = $(`#pay-slot-${personIdx}`);
  const note = $(`#pay-note-${personIdx}`);
  if (!PAYPAL_CURRENCIES.has(state.currency)) {
    note.textContent = `PayPal checkout doesn't support ${state.currency} — shares are shown for settlement outside PayPal, or re-run the bill in a supported currency.`;
    return;
  }
  if (state.config.paypalMode === 'sandbox') {
    renderSandboxButton(personIdx, slot, note);
  } else {
    const btn = document.createElement('button');
    btn.className = 'pay-btn';
    btn.textContent = `Pay ${formatMoney(totalMinor, state.currency)} with PayPal (demo)`;
    btn.addEventListener('click', () => demoPay(personIdx, btn));
    slot.appendChild(btn);
    note.textContent = 'Demo mode: runs the same create → approve → capture flow against simulated orders.';
  }
}

async function ensureSdk() {
  if (state.sdkLoadedFor === state.currency) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(
      state.config.paypalClientId,
    )}&currency=${state.currency}&intent=capture`;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  state.sdkLoadedFor = state.currency;
}

async function renderSandboxButton(personIdx, slot, note) {
  try {
    await ensureSdk();
    window.paypal
      .Buttons({
        style: { layout: 'vertical', label: 'pay' },
        createOrder: async () => {
          const share = currentSplit().people[personIdx];
          const res = await fetch('/api/paypal/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              totalMinor: share.totalMinor,
              currency: state.currency,
              personName: state.people[personIdx],
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Could not create the PayPal order.');
          return data.id;
        },
        onApprove: async (data) => {
          const res = await fetch(`/api/paypal/orders/${data.orderID}/capture`, {
            method: 'POST',
          });
          const result = await res.json();
          if (!res.ok) throw new Error(result.error || 'Capture failed.');
          state.paid[personIdx] = { mode: result.mode, captureId: result.captureId || result.id };
          renderShares();
        },
        onError: (err) => {
          note.textContent = `PayPal error: ${err?.message || 'checkout was cancelled or failed.'}`;
        },
      })
      .render(slot);
  } catch {
    note.textContent = 'Could not load the PayPal checkout. Check your connection and reload.';
  }
}

async function demoPay(personIdx, btn) {
  const share = currentSplit().people[personIdx];
  btn.disabled = true;
  btn.textContent = 'Processing…';
  try {
    const createRes = await fetch('/api/paypal/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        totalMinor: share.totalMinor,
        currency: state.currency,
        personName: state.people[personIdx],
      }),
    });
    const order = await createRes.json();
    if (!createRes.ok) throw new Error(order.error || 'Could not create the order.');
    const capRes = await fetch(`/api/paypal/orders/${order.id}/capture`, { method: 'POST' });
    const capture = await capRes.json();
    if (!capRes.ok) throw new Error(capture.error || 'Capture failed.');
    state.paid[personIdx] = { mode: capture.mode, captureId: capture.captureId || capture.id };
    renderShares();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Try again';
    $(`#pay-note-${personIdx}`).textContent = err.message;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

$('#analyze-btn').addEventListener('click', analyze);
$('#tax-input').addEventListener('change', (e) => {
  state.taxMinor = toMinor(Number(e.target.value || 0), state.currency);
  renderShares();
});
$('#tip-input').addEventListener('change', (e) => {
  state.tipMinor = toMinor(Number(e.target.value || 0), state.currency);
  renderShares();
});
$('#add-item-btn').addEventListener('click', () => {
  state.items.push({ name: 'New item', qty: 1, lineTotalMinor: 0, assignees: [] });
  renderItems();
  renderShares();
});

loadConfig();
