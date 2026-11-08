// Tamper-evident evidence ledger: each entry's hash covers the previous entry's hash.
import crypto from "node:crypto";

const GENESIS = "0".repeat(64);
let entries = [];

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

export function append(type, requestId, data = {}) {
  const prevHash = entries.length ? entries[entries.length - 1].hash : GENESIS;
  const body = {
    seq: entries.length + 1,
    ts: new Date().toISOString(),
    type,
    requestId: requestId || null,
    data,
  };
  const hash = sha(prevHash + JSON.stringify(body));
  const entry = { ...body, prevHash, hash };
  entries.push(entry);
  return entry;
}

export function all() {
  return entries;
}

export function forRequest(requestId) {
  return entries.filter((e) => e.requestId === requestId);
}

export function verify() {
  let prev = GENESIS;
  for (const e of entries) {
    const { prevHash, hash, ...body } = e;
    if (prevHash !== prev || hash !== sha(prev + JSON.stringify(body))) {
      return { valid: false, brokenAt: e.seq, length: entries.length };
    }
    prev = hash;
  }
  return { valid: true, length: entries.length };
}

export function reset() {
  entries = [];
  tamperBackup = null;
}

// ---- demo only: simulate someone editing a record after the fact ----
let tamperBackup = null;

export function isTampered() {
  return tamperBackup !== null;
}

export function tamper() {
  if (tamperBackup || entries.length === 0) return null;
  // Prefer editing a policy decision (most convincing for the demo), else the first entry.
  const target = [...entries].reverse().find((e) => e.type === "policy_decision") || entries[0];
  tamperBackup = { seq: target.seq, data: JSON.parse(JSON.stringify(target.data)) };
  if (target.data && typeof target.data === "object") {
    if ("decision" in target.data) target.data.decision = target.data.decision === "block" ? "approve" : "block";
    else target.data._edited = true;
  }
  return target.seq;
}

export function restore() {
  if (!tamperBackup) return false;
  const target = entries.find((e) => e.seq === tamperBackup.seq);
  if (target) target.data = tamperBackup.data;
  tamperBackup = null;
  return true;
}
