// SplitBill AI — PayPal integration (Sandbox, Orders API v2).
//
// Real mode: PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET are set (sandbox app
// credentials from developer.paypal.com). The server obtains an OAuth
// token, creates real sandbox orders, and captures them after approval.
//
// Demo mode: credentials are absent. The full request/response flow still
// runs through the same endpoints, but orders are simulated server-side
// and clearly labelled DEMO everywhere, so the product can be evaluated
// end-to-end before a developer account exists. The client SECRET is
// only used in the Basic-auth header to PayPal — never logged/returned.

const SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';

export function paypalMode() {
  return process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET
    ? 'sandbox'
    : 'demo';
}

let tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken(fetchImpl = fetch) {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const basic = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`,
  ).toString('base64');
  const res = await fetchImpl(`${SANDBOX_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`PayPal OAuth failed with HTTP ${res.status}`);
  const data = await res.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, data.expires_in - 60) * 1000,
  };
  return tokenCache.token;
}

// In-memory demo order store (demo mode only; a restart clears it).
const demoOrders = new Map();

// Create an order for one person's share. `value` is the decimal string
// produced by split.js paypalValue(). Returns { id, mode, status }.
export async function createOrder({ value, currency, description }, fetchImpl = fetch) {
  if (paypalMode() === 'demo') {
    const id = `DEMO-${Date.now().toString(36).toUpperCase()}-${Math.floor(
      Math.random() * 1e6,
    )}`;
    demoOrders.set(id, { value, currency, description, status: 'CREATED' });
    return { id, mode: 'demo', status: 'CREATED' };
  }
  const token = await getAccessToken(fetchImpl);
  const res = await fetchImpl(`${SANDBOX_BASE}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          description: String(description || 'SplitBill AI share').slice(0, 127),
          amount: { currency_code: currency, value },
        },
      ],
      application_context: {
        brand_name: 'SplitBill AI',
        user_action: 'PAY_NOW',
      },
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `PayPal create order failed with HTTP ${res.status}: ${data?.name || 'unknown error'}`,
    );
  }
  return { id: data.id, mode: 'sandbox', status: data.status };
}

// Capture an approved order. Returns { id, mode, status, captureId }.
export async function captureOrder(orderId, fetchImpl = fetch) {
  if (paypalMode() === 'demo') {
    const order = demoOrders.get(orderId);
    if (!order) throw new Error('Demo order not found (server restarted?).');
    order.status = 'COMPLETED';
    return { id: orderId, mode: 'demo', status: 'COMPLETED', captureId: `DEMO-CAP-${orderId}` };
  }
  const token = await getAccessToken(fetchImpl);
  const res = await fetchImpl(`${SANDBOX_BASE}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `PayPal capture failed with HTTP ${res.status}: ${data?.name || 'unknown error'}`,
    );
  }
  const captureId =
    data?.purchase_units?.[0]?.payments?.captures?.[0]?.id || null;
  return { id: data.id, mode: 'sandbox', status: data.status, captureId };
}
