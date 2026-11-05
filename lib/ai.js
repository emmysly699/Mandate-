// One small module for all AI calls (Gemini, REST). Swap providers by editing only this file.
const BASE = (process.env.GEMINI_BASE || "https://generativelanguage.googleapis.com").replace(/\/$/, "");

export function aiEnabled() {
  return Boolean(process.env.GEMINI_API_KEY);
}

function modelList() {
  const primary = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const backup = process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash-lite";
  return primary === backup ? [primary] : [primary, backup];
}

function parseJson(text) {
  const clean = String(text || "").replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1));
    throw new Error("AI did not return valid JSON");
  }
}

// Ask the model for a JSON object. Returns { data, model }. Throws if every model fails.
export async function askJson(system, prompt) {
  if (!aiEnabled()) throw new Error("GEMINI_API_KEY not set");
  let lastError = null;

  for (const model of modelList()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(`${BASE}/v1beta/models/${model}:generateContent`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        lastError = new Error(`Gemini ${model} error ${res.status}: ${body?.error?.message || "unknown"}`);
        continue; // try the backup model
      }
      const text = (body.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
      return { data: parseJson(text), model };
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("AI call failed");
}
