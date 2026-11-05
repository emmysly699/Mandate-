// PayPal sandbox helpers.
const API = "https://api-m.sandbox.paypal.com";
let cached = { token: null, expiresAt: 0 };

export function missingEnv() {
  return ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"].filter((k) => !process.env[k]);
}

export async function getAccessToken() {
  if (cached.token && Date.now() < cached.expiresAt) return cached.token;
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${API}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal token error ${res.status}: ${JSON.stringify(data)}`);
  cached = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cached.token;
}

export async function paypalFetch(path, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function createOrder({ amount, description, customId, baseUrl }) {
  const { ok, status, data } = await paypalFetch("/v2/checkout/orders", {
    method: "POST",
    headers: { "PayPal-Request-Id": `mandate-${customId}-${Date.now()}` },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: customId,
          custom_id: customId,
          description: String(description).slice(0, 120),
          amount: { currency_code: "USD", value: Number(amount).toFixed(2) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            return_url: `${baseUrl}/paypal/return`,
            cancel_url: `${baseUrl}/paypal/cancel`,
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
          },
        },
      },
    }),
  });
  if (!ok) throw new Error(`Create order failed (${status}): ${JSON.stringify(data)}`);
  const link = (data.links || []).find((l) => l.rel === "payer-action" || l.rel === "approve");
  if (!link) throw new Error("PayPal returned no approval link");
  return { orderId: data.id, approveUrl: link.href };
}

export async function captureOrder(orderId) {
  const { ok, status, data } = await paypalFetch(`/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: { "PayPal-Request-Id": `capture-${orderId}` },
    body: JSON.stringify({}),
  });
  if (!ok) throw new Error(`Capture failed (${status}): ${JSON.stringify(data)}`);
  const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    orderId: data.id,
    orderStatus: data.status,
    captureId: capture?.id || null,
    captureStatus: capture?.status || null,
    amount: capture?.amount || null,
  };
}
