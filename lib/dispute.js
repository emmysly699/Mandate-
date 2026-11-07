// Dispute copilot: turns the evidence ledger into a dispute packet and a response letter.
// Strength is decided by plain rules (explainable). AI only helps write the letter.
import crypto from "node:crypto";
import { aiEnabled, askJson } from "./ai.js";

export const DISPUTE_REASONS = {
  unauthorized: "I didn't authorize this purchase",
  not_as_ordered: "This isn't what I asked my agent to buy",
  wrong_amount: "I was charged more than expected",
};

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const find = (entries, type) => entries.find((e) => e.type === type);

function maskEmail(email) {
  if (!email || !email.includes("@")) return null;
  const [name, domain] = email.split("@");
  return `${name[0]}***@${domain}`;
}

export function buildEvidence({ request, reason, entries, chain, live }) {
  const task = find(entries, "agent_task");
  const policy = find(entries, "policy_decision");
  const review = find(entries, "intent_review");
  const human = entries.find((e) => e.type === "human_decision" && e.data?.action === "approve");
  const order = find(entries, "paypal_order_created");
  const capture = find(entries, "paypal_capture");

  const total = Number(request.total).toFixed(2);
  const captured = capture?.data?.captureStatus === "COMPLETED";
  const captureAmount = capture?.data?.amount?.value || null;
  const liveCapture = live?.purchase_units?.[0]?.payments?.captures?.[0] || null;
  const liveAmount = liveCapture?.amount?.value || null;

  const authorization = {
    mandateOnRecord: Boolean(task?.data?.mandate),
    mandateSnapshot: task?.data?.mandate || null,
    policyDecision: policy?.data?.decision || null,
    policyChecks: policy?.data?.checks || [],
    aiReview: review ? { verdict: review.data.verdict, note: review.data.note, source: review.data.source } : null,
    approvedByUserInDashboard: Boolean(human),
    approvedByUserAt: human?.ts || null,
    buyerApprovedOnPayPal: captured,
  };

  const payment = {
    orderId: order?.data?.orderId || request.orderId,
    captureId: capture?.data?.captureId || request.captureId,
    captureStatus: capture?.data?.captureStatus || null,
    amountRecorded: captureAmount,
    amountExpected: total,
    currency: "USD",
    paypalLiveCheck: live
      ? {
          orderStatus: live.status,
          captureAmount: liveAmount,
          captureTime: liveCapture?.create_time || null,
          payerName: [live.payer?.name?.given_name, live.payer?.name?.surname].filter(Boolean).join(" ") || null,
          payerEmailMasked: maskEmail(live.payer?.email_address),
        }
      : null,
  };

  // ----- strength (rules) -----
  const reasons = [];
  let level;
  const amountMatches = captureAmount === total;
  const liveMatches = liveAmount ? liveAmount === total : null;

  if (!chain.valid) {
    level = "weak";
    reasons.push("The evidence ledger failed its integrity check, so the records cannot be relied on.");
  } else if (reason === "unauthorized") {
    if (captured) reasons.push("The account holder approved this payment on PayPal's own checkout before it was captured.");
    if (authorization.mandateOnRecord) reasons.push("A spending mandate set by the account holder was on record before the purchase.");
    if (authorization.policyDecision === "approve") reasons.push("The purchase passed every mandate rule.");
    if (authorization.approvedByUserInDashboard) reasons.push("The account holder explicitly approved it in the dashboard.");
    level = captured && authorization.mandateOnRecord && (authorization.policyDecision === "approve" || authorization.approvedByUserInDashboard) ? "strong" : captured ? "moderate" : "weak";
  } else if (reason === "wrong_amount") {
    if (amountMatches) reasons.push(`The captured amount ($${captureAmount}) matches the amount shown for approval ($${total}).`);
    else reasons.push(`The captured amount ($${captureAmount ?? "unknown"}) does not match the approved amount ($${total}).`);
    if (liveMatches === true) reasons.push("PayPal's live order record shows the same amount.");
    if (liveMatches === false) reasons.push("PayPal's live order record shows a different amount.");
    level = amountMatches && liveMatches !== false ? "strong" : "weak";
  } else {
    reasons.push(`The agent was asked: "${request.task}" and chose "${request.item?.name}".`);
    if (authorization.aiReview?.verdict === "concern") {
      reasons.push("The AI reviewer flagged a concern about this purchase at the time.");
      level = "weak";
    } else {
      reasons.push("The AI reviewer found the purchase consistent with the stated intent.");
      level = request.agent?.reasoning ? "moderate" : "weak";
    }
    if (authorization.approvedByUserInDashboard) reasons.push("The account holder reviewed and approved this specific purchase.");
  }

  const recommendation = level === "strong" ? "Contest the dispute" : level === "moderate" ? "Contest, but review the evidence first" : "Consider refunding";

  const packet = {
    generatedAt: new Date().toISOString(),
    reason,
    reasonText: DISPUTE_REASONS[reason],
    purchase: { requestId: request.id, task: request.task, item: request.item, quantity: request.quantity, total, currency: "USD" },
    authorization,
    payment,
    timeline: entries.map((e) => ({ seq: e.seq, ts: e.ts, type: e.type, hash: e.hash })),
    integrity: { chainValid: chain.valid, ledgerLength: chain.length, lastEntryHash: entries[entries.length - 1]?.hash || null },
    strength: { level, recommendation, reasons },
  };
  return packet;
}

export function packetHash(packet) {
  return sha(JSON.stringify(packet));
}

function templateLetter(p) {
  const date = p.payment.paypalLiveCheck?.captureTime || p.timeline.at(-1)?.ts || p.generatedAt;
  const lines = [
    `Re: Dispute on PayPal order ${p.payment.orderId} (capture ${p.payment.captureId}), $${p.purchase.total} ${p.purchase.currency}`,
    "",
    `Claim: "${p.reasonText}".`,
    "",
    `On record: the account holder set a spending mandate and asked their AI shopping agent: "${p.purchase.task}". The agent selected "${p.purchase.item?.name}" (quantity ${p.purchase.quantity}). The purchase was checked against the mandate and the decision was "${p.authorization.policyDecision}".`,
  ];
  if (p.authorization.approvedByUserInDashboard) lines.push(`The account holder then approved this purchase in the dashboard at ${p.authorization.approvedByUserAt}.`);
  if (p.authorization.buyerApprovedOnPayPal) lines.push(`The buyer approved the payment on PayPal's checkout and the capture of $${p.payment.amountRecorded} completed (around ${date}).`);
  lines.push("", `Every step above is stored in a hash-chained ledger (${p.integrity.ledgerLength} entries, integrity check: ${p.integrity.chainValid ? "passed" : "FAILED"}).`);
  lines.push("", `Assessment: ${p.strength.level}. ${p.strength.recommendation}.`);
  return lines.join("\n");
}

export async function draftLetter(packet) {
  if (!aiEnabled()) return { letter: templateLetter(packet), source: "template" };
  try {
    const facts = { ...packet, timeline: packet.timeline.map((t) => `${t.seq}:${t.type}`) };
    const { data, model } = await askJson(
      "You write concise, factual dispute response letters for a payments platform. Use ONLY the facts in the evidence JSON. Never invent dates, names, amounts or events. Plain language, 150-220 words, no markdown. Reply with JSON only: {\"letter\": string}.",
      `Write the response letter for this dispute evidence:\n${JSON.stringify(facts)}`
    );
    const letter = String(data.letter || "").trim();
    if (letter.length < 60) throw new Error("letter too short");
    return { letter, source: model };
  } catch (err) {
    return { letter: templateLetter(packet), source: `template (AI error: ${String(err.message).slice(0, 60)})` };
  }
}
