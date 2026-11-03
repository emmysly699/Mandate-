// Mandate - Day 1 spike: prove the PayPal sandbox flow works end to end.
// Flow: create order -> buyer approves on PayPal -> PayPal redirects back -> we capture.
import express from "express";
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const PAYPAL_API = "https://api-m.sandbox.paypal.com"; // sandbox only
function requireEnv() {
  const missing = [];
  if (!CLIENT_ID) missing.push("PAYPAL_CLIENT_ID");
  if (!CLIENT_SECRET) missing.push("PAYPAL_CLIENT_SECRET");
  return missing;
}

// Get a short-lived access token from PayPal.
async function getAccessToken() {
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
"Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Token error ${res.status}: ${JSON.stringify(data)}`);
  return data.access_token;
}
async function paypalFetch(path, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${PAYPAL_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// 1. Health check + config status
app.get("/", (req, res) => {
  const missing = requireEnv();
  res.json({
    app: "Mandate",
    status: missing.length ? "missing env vars" : "ready",
    missing,
    baseUrl: BASE_URL,
    try: [`${BASE_URL}/paypal/token-check`, `${BASE_URL}/paypal/create?amount=10`],
  });
});

// 2. Confirms your Client ID and Secret work (does not move money)
app.get("/paypal/token-check", async (req, res) => {
  try {
    const missing = requireEnv();
    if (missing.length) return res.status(500).json({ error: "missing env vars", missing });
    const token = await getAccessToken();
    res.json({ ok: true, message: "Sandbox credentials work", tokenPreview: token.slice(0, 8) + "..." });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 3. Create an order and send you to PayPal to approve it as the sandbox buyer
app.get("/paypal/create", async (req, res) => {
  try {
    const amount = Number(req.query.amount || 10).toFixed(2);
    const { ok, status, data } = await paypalFetch("/v2/checkout/orders", {
      method: "POST",
      headers: { "PayPal-Request-Id": `mandate-${Date.now()}` },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            description: "Mandate sandbox test purchase",
            amount: { currency_code: "USD", value: amount },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: `${BASE_URL}/paypal/return`,
              cancel_url: `${BASE_URL}/paypal/cancel`,
              user_action: "PAY_NOW",
              shipping_preference: "NO_SHIPPING",
            },
          },
        },
      }),
    });
    if (!ok) return res.status(status).json({ error: "create order failed", details: data });

    const link = (data.links || []).find((l) => l.rel === "payer-action" || l.rel === "approve");
    if (!link) return res.status(500).json({ error: "no approval link returned", order: data });

    // ?json=1 returns the data instead of redirecting
    if (req.query.json) return res.json({ orderId: data.id, status: data.status, approveUrl: link.href });
    res.redirect(link.href);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. PayPal sends the buyer back here after approval; we capture the payment
app.get("/paypal/return", async (req, res) => {
  try {
    const orderId = req.query.token;
    if (!orderId) return res.status(400).json({ error: "missing order token" });
    const { ok, status, data } = await paypalFetch(`/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      headers: { "PayPal-Request-Id": `capture-${orderId}` },
      body: JSON.stringify({}),
    });
    if (!ok) return res.status(status).json({ error: "capture failed", details: data });
    const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
    res.json({
      ok: true,
      orderId: data.id,
      orderStatus: data.status,
      captureId: capture?.id,
      captureStatus: capture?.status,
      amount: capture?.amount,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/paypal/cancel", (req, res) => res.json({ ok: false, message: "Buyer cancelled the order" }));

// 5. Look up any order (useful later for the evidence ledger)
app.get("/paypal/order/:id", async (req, res) => {
  try {
    const { ok, status, data } = await paypalFetch(`/v2/checkout/orders/${req.params.id}`);
    res.status(ok ? 200 : status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Mandate listening on ${PORT}`));