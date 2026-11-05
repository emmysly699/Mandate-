// In-memory demo state. Resets when the server restarts (fine for a demo).
import crypto from "node:crypto";

export function defaultMandate() {
  return {
    monthlyBudget: 150,
    perPurchaseCap: 50,
    askAbove: 30,
    allowedCategories: ["groceries", "phone-plan", "utilities", "learning"],
    intent: "I only want essentials: groceries, my phone plan, utilities and learning. No impulse gadgets, subscriptions or gift cards.",
  };
}

export const state = { mandate: defaultMandate(), requests: [] };

export function resetState() {
  state.mandate = defaultMandate();
  state.requests = [];
}

const round2 = (n) => Math.round(n * 100) / 100;

// Money already used or promised: approved (awaiting payment) + paid.
export function committedSpend() {
  return round2(state.requests.filter((r) => r.status === "approved" || r.status === "payment_failed" || r.status === "paid").reduce((s, r) => s + r.total, 0));
}

export function paidSpend() {
  return round2(state.requests.filter((r) => r.status === "paid").reduce((s, r) => s + r.total, 0));
}

export function newId() {
  return "req_" + crypto.randomBytes(4).toString("hex");
}
