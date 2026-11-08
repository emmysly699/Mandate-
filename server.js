// Mandate: a trust layer between AI shopping agents and PayPal.
// Flow: agent request -> policy rules -> AI intent review -> (human approval) -> PayPal order -> capture.
// Every step is written to a hash-chained evidence ledger.

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CATALOG, CATEGORIES } from "./lib/catalog.js";
import { evaluate } from "./lib/policy.js";
import { chooseItem, reviewIntent } from "./lib/agent.js";
import { aiEnabled } from "./lib/ai.js";
import { DISPUTE_REASONS, buildEvidence, draftLetter, packetHash } from "./lib/dispute.js";
import * as ledger from "./lib/ledger.js";
import { state, resetState, committedSpend, paidSpend, newId } from "./lib/store.js";
import { missingEnv, getAccessToken, createOrder, captureOrder, paypalFetch } from "./lib/paypal.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

const findRequest = (id) => state.requests.find((r) => r.id === id);
const round2 = (n) => Math.round(n * 100) / 100;

// ---------- health ----------
app.get("/health", (req, res) => {
  const missing = missingEnv();
  res.json({ app: "Mandate", status: missing.length ? "missing env vars" : "ready", missing, baseUrl: BASE_URL, ai: aiEnabled() ? "gemini" : "fallback (no GEMINI_API_KEY)" });
});

// ---------- state for the dashboard ----------
app.get("/api/state", (req, res) => {
  res.json({
    mandate: state.mandate,
    categories: CATEGORIES,
    catalog: CATALOG,
    committed: committedSpend(),
    paid: paidSpend(),
    requests: [...state.requests].reverse(),
    chain: ledger.verify(),
    tampered: ledger.isTampered(),
    ai: aiEnabled(),
  });
});

app.get("/api/ledger", (req, res) => res.json({ chain: ledger.verify(), entries: ledger.all() }));

// ---------- mandate ----------
app.put("/api/mandate", (req, res) => {
  const b = req.body || {};
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? round2(Number(v)) : null);
  const monthlyBudget = num(b.monthlyBudget);
  const perPurchaseCap = num(b.perPurchaseCap);
  const askAbove = num(b.askAbove);
  if (monthlyBudget === null || perPurchaseCap === null || askAbove === null) return res.status(400).json({ error: "Budget, cap and threshold must be numbers of 0 or more" });
  const allowedCategories = Array.isArray(b.allowedCategories) ? b.allowedCategories.filter((c) => CATEGORIES.includes(c)) : [];
  const intent = String(b.intent || "").slice(0, 300);
  state.mandate = { monthlyBudget, perPurchaseCap, askAbove, allowedCategories, intent };
  ledger.append("mandate_updated", null, { mandate: state.mandate });
  res.json({ ok: true, mandate: state.mandate });
});

// ---------- agent run ----------
app.post("/api/agent/run", async (req, res) => {
  const task = String(req.body?.task || "").trim().slice(0, 200);
  if (!task) return res.status(400).json({ error: "Tell the agent what to buy" });

  const id = newId();
  const mandate = JSON.parse(JSON.stringify(state.mandate)); // snapshot used for this decision
  const request = { id, task, createdAt: new Date().toISOString(), mandate, status: "pending", item: null, quantity: 0, total: 0, agent: null, policy: null, review: null, orderId: null, captureId: null, note: null };
  ledger.append("agent_task", id, { task, mandate });

  const choice = await chooseItem(task);
  request.agent = { reasoning: choice.reasoning, source: choice.source };

  if (!choice.item) {
    request.status = "no_match";
    ledger.append("agent_no_match", id, { reasoning: choice.reasoning, source: choice.source });
    state.requests.push(request);
    return res.json({ ok: true, request });
  }

  request.item = { id: choice.item.id, name: choice.item.name, category: choice.item.category, price: choice.item.price };
  request.quantity = choice.quantity;
  ledger.append("agent_choice", id, { item: request.item, quantity: choice.quantity, reasoning: choice.reasoning, source: choice.source });

  const policy = evaluate(mandate, committedSpend(), choice.item, choice.quantity);
  request.policy = policy;
  request.total = policy.total;
  ledger.append("policy_decision", id, { decision: policy.decision, total: policy.total, checks: policy.checks });

  if (policy.decision !== "block") {
    request.review = await reviewIntent(mandate, task, choice.item, choice.quantity, choice.reasoning);
    ledger.append("intent_review", id, request.review);
  }

  if (policy.decision === "block") {
    request.status = "blocked";
  } else if (policy.decision === "ask") {
    request.status = "awaiting_approval";
  } else if (request.review?.verdict === "concern") {
    request.status = "awaiting_approval";
    request.note = "Rules passed, but the AI reviewer flagged a concern, so your approval is needed.";
  } else {
    request.status = "approved";
  }
  ledger.append("final_decision", id, { status: request.status, note: request.note });

  state.requests.push(request);
  res.json({ ok: true, request });
});

// ---------- human decision on a request that needs approval ----------
app.post("/api/requests/:id/decision", (req, res) => {
  const r = findRequest(req.params.id);
  if (!r) return res.status(404).json({ error: "Request not found" });
  if (r.status !== "awaiting_approval") return res.status(409).json({ error: "This request is not waiting for approval" });
  const action = req.body?.action;

  if (action === "reject") {
    r.status = "rejected";
    ledger.append("human_decision", r.id, { action: "reject" });
    return res.json({ ok: true, request: r });
  }
  if (action === "approve") {
    const remaining = round2(state.mandate.monthlyBudget - committedSpend());
    if (r.total > remaining) return res.status(409).json({ error: `Budget check failed: $${r.total} is more than the $${Math.max(remaining, 0)} left` });
    r.status = "approved";
    ledger.append("human_decision", r.id, { action: "approve" });
    return res.json({ ok: true, request: r });
  }
  res.status(400).json({ error: "action must be approve or reject" });
});

// ---------- start PayPal payment for an approved request ----------
app.post("/api/requests/:id/pay", async (req, res) => {
  const r = findRequest(req.params.id);
  if (!r) return res.status(404).json({ error: "Request not found" });
  if (r.status !== "approved" && r.status !== "payment_failed") return res.status(409).json({ error: "This request is not approved for payment" });
  try {
    if (missingEnv().length) throw new Error("PayPal credentials missing on the server");
    const { orderId, approveUrl } = await createOrder({ amount: r.total, description: `${r.item.name} x${r.quantity}`, customId: r.id, baseUrl: BASE_URL });
    r.orderId = orderId;
    r.status = "approved";
    ledger.append("paypal_order_created", r.id, { orderId, amount: r.total, currency: "USD" });
    res.json({ ok: true, approveUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- dispute copilot ----------
app.post("/api/requests/:id/dispute", async (req, res) => {
  const r = findRequest(req.params.id);
  if (!r) return res.status(404).json({ error: "Request not found" });
  if (r.status !== "paid") return res.status(409).json({ error: "Only paid purchases can be disputed" });
  if (r.dispute) return res.status(409).json({ error: "A dispute is already open for this purchase" });
  const reason = req.body?.reason;
  if (!DISPUTE_REASONS[reason]) return res.status(400).json({ error: "Choose a dispute reason" });

  // Live lookup of the order from PayPal (skipped quietly if unavailable)
  let live = null;
  if (r.orderId && !missingEnv().length) {
    try {
      const o = await paypalFetch(`/v2/checkout/orders/${r.orderId}`);
      if (o.ok) live = o.data;
    } catch {}
  }

  const packet = buildEvidence({ request: r, reason, entries: ledger.forRequest(r.id), chain: ledger.verify(), live });
  const { letter, source } = await draftLetter(packet);
  const hash = packetHash(packet);
  ledger.append("dispute_opened", r.id, { reason, strength: packet.strength.level, packetHash: hash });
  r.dispute = { reason, reasonText: DISPUTE_REASONS[reason], openedAt: new Date().toISOString(), strength: packet.strength, letter, letterSource: source, packetHash: hash, simulated: true, packet };
  res.json({ ok: true, dispute: r.dispute });
});

app.get("/api/requests/:id/evidence", (req, res) => {
  const r = findRequest(req.params.id);
  if (!r || !r.dispute) return res.status(404).json({ error: "No dispute for this request" });
  res.type("json").send(JSON.stringify({ packetHash: r.dispute.packetHash, letter: r.dispute.letter, packet: r.dispute.packet }, null, 2));
});

// ---------- demo tools: show that the ledger detects edits ----------
app.post("/api/demo/tamper", (req, res) => {
  const seq = ledger.tamper();
  if (!seq) return res.status(409).json({ error: ledger.isTampered() ? "Ledger is already tampered with" : "Nothing in the ledger yet. Run a request first." });
  res.json({ ok: true, editedEntry: seq, chain: ledger.verify() });
});

app.post("/api/demo/restore", (req, res) => {
  if (!ledger.restore()) return res.status(409).json({ error: "Nothing to restore" });
  res.json({ ok: true, chain: ledger.verify() });
});

// ---------- reset the demo ----------
app.post("/api/reset", (req, res) => {
  resetState();
  ledger.reset();
  res.json({ ok: true });
});

// ---------- PayPal return / cancel ----------
app.get("/paypal/return", async (req, res) => {
  const orderId = req.query.token;
  if (!orderId) return res.status(400).json({ error: "missing order token" });
  const r = state.requests.find((x) => x.orderId === orderId);
  try {
    const result = await captureOrder(orderId);
    if (!r) return res.json({ ok: true, testOrder: true, ...result }); // plain sandbox test order
    r.captureId = result.captureId;
    r.status = result.captureStatus === "COMPLETED" ? "paid" : "payment_failed";
    r.paidAt = new Date().toISOString();
    ledger.append("paypal_capture", r.id, result);
    return res.redirect(`/?paid=${r.id}`);
  } catch (err) {
    if (r) {
      r.status = "payment_failed";
      r.note = String(err.message).slice(0, 200);
      ledger.append("paypal_capture_failed", r.id, { error: r.note });
      return res.redirect(`/?failed=${r.id}`);
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/paypal/cancel", (req, res) => {
  const r = state.requests.find((x) => x.orderId === req.query.token);
  if (r) ledger.append("buyer_cancelled", r.id, { orderId: r.orderId });
  res.redirect("/?cancelled=1");
});

// ---------- sandbox test helpers (from day 1) ----------
app.get("/paypal/token-check", async (req, res) => {
  try {
    const missing = missingEnv();
    if (missing.length) return res.status(500).json({ error: "missing env vars", missing });
    const token = await getAccessToken();
    res.json({ ok: true, message: "Sandbox credentials work", tokenPreview: token.slice(0, 8) + "..." });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/paypal/order/:id", async (req, res) => {
  try {
    const { ok, status, data } = await paypalFetch(`/v2/checkout/orders/${req.params.id}`);
    res.status(ok ? 200 : status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Mandate listening on ${PORT}`));
