// Deterministic policy engine. No AI here: rules decide, and every check is recorded as evidence.
const round2 = (n) => Math.round(n * 100) / 100;

export function evaluate(mandate, committed, item, quantity) {
  const total = round2(item.price * quantity);
  const remaining = round2(mandate.monthlyBudget - committed);
  const checks = [];

  const categoryOk = mandate.allowedCategories.includes(item.category);
  checks.push({
    rule: "category",
    pass: categoryOk,
    detail: categoryOk ? `Category "${item.category}" is allowed` : `Category "${item.category}" is not in your allowed list`,
  });

  const capOk = total <= mandate.perPurchaseCap;
  checks.push({
    rule: "per_purchase_cap",
    pass: capOk,
    detail: capOk ? `$${total} is within the $${mandate.perPurchaseCap} per-purchase cap` : `$${total} exceeds the $${mandate.perPurchaseCap} per-purchase cap`,
  });

  const budgetOk = total <= remaining;
  checks.push({
    rule: "monthly_budget",
    pass: budgetOk,
    detail: budgetOk ? `$${total} fits the $${remaining} left this month` : `$${total} is more than the $${Math.max(remaining, 0)} left this month`,
  });

  const needsApproval = total > mandate.askAbove;
  checks.push({
    rule: "approval_threshold",
    pass: !needsApproval,
    detail: needsApproval ? `$${total} is above your $${mandate.askAbove} approval threshold` : `$${total} is at or under your $${mandate.askAbove} approval threshold`,
  });

  let decision = "approve";
  if (!categoryOk || !capOk || !budgetOk) decision = "block";
  else if (needsApproval) decision = "ask";

  return { decision, total, remaining, checks };
}
