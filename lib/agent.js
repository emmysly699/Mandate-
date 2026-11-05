// The demo shopping agent and the intent reviewer. Both use AI when available and
// fall back to simple logic so the demo never crashes if the AI is rate-limited.
import { CATALOG, findItem } from "./catalog.js";
import { aiEnabled, askJson } from "./ai.js";

function fallbackChoose(task) {
  const text = task.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const item of CATALOG) {
    let score = 0;
    for (const k of item.keywords) if (text.includes(k)) score += 1;
    if (text.includes(item.category)) score += 1;
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best
    ? { item: best, quantity: 1, reasoning: `Matched "${best.name}" to your request by keywords (AI unavailable, fallback logic used).`, source: "fallback" }
    : { item: null, quantity: 0, reasoning: "Nothing in the shop matched this request.", source: "fallback" };
}

export async function chooseItem(task) {
  if (!aiEnabled()) return fallbackChoose(task);
  try {
    const catalog = CATALOG.map(({ id, name, category, price }) => ({ id, name, category, price }));
    const { data, model } = await askJson(
      "You are a shopping agent acting for a user. Pick the single best item from the catalog for the user's request. Reply with JSON only: {\"itemId\": string or null, \"quantity\": integer 1-5, \"reasoning\": short sentence}. Use null if nothing fits. Never invent items.",
      `Catalog: ${JSON.stringify(catalog)}\nUser request: ${JSON.stringify(task)}`
    );
    const item = data.itemId ? findItem(String(data.itemId)) : null;
    if (!item) return { item: null, quantity: 0, reasoning: String(data.reasoning || "Nothing in the shop matched this request."), source: model };
    const quantity = Math.min(5, Math.max(1, parseInt(data.quantity, 10) || 1));
    return { item, quantity, reasoning: String(data.reasoning || "").slice(0, 300), source: model };
  } catch (err) {
    const fb = fallbackChoose(task);
    fb.reasoning += ` [AI error: ${String(err.message).slice(0, 80)}]`;
    return fb;
  }
}

export async function reviewIntent(mandate, task, item, quantity, agentReasoning) {
  if (!aiEnabled()) return { verdict: "ok", note: "AI reviewer unavailable; rules-only check.", source: "fallback" };
  try {
    const { data, model } = await askJson(
      "You review purchases an AI agent wants to make for a user. Judge whether the purchase matches what the user said they want. Reply with JSON only: {\"verdict\": \"ok\" or \"concern\", \"note\": one short sentence}. Use \"concern\" only if the purchase conflicts with the user's stated intent or looks unusual for the request.",
      `User's stated intent: ${JSON.stringify(mandate.intent)}\nUser's request to the agent: ${JSON.stringify(task)}\nAgent chose: ${JSON.stringify({ name: item.name, category: item.category, price: item.price, quantity })}\nAgent's reasoning: ${JSON.stringify(agentReasoning)}`
    );
    const verdict = data.verdict === "concern" ? "concern" : "ok";
    return { verdict, note: String(data.note || "").slice(0, 200), source: model };
  } catch (err) {
    return { verdict: "ok", note: `AI reviewer error, rules-only check. (${String(err.message).slice(0, 80)})`, source: "fallback" };
  }
}
