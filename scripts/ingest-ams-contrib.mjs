/**
 * Ingest HGPEdu "chem submit" envelopes from portal AMS into Autopilot sandbox artifacts.
 * ESM version (repo uses "type":"module").
 *
 * Source:
 *  - https://portal.onetoo.eu/ams/v1/envelopes?thread=t_contrib_submit
 *
 * Output:
 *  - data/ams/contrib-sandbox.v1.json
 *  - data/ams/contrib-rejected.v1.json
 *  - data/ams/lastCursor.txt
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_BASE = "https://portal.onetoo.eu";
const THREAD = "t_contrib_submit";

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// Deterministic JSON stringify: stable key order (used only for canonical hashing)
function stableStringify(x) {
  if (x === null || typeof x !== "object") return JSON.stringify(x);
  if (Array.isArray(x)) return "[" + x.map(stableStringify).join(",") + "]";
  const keys = Object.keys(x).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(x[k])).join(",") + "}";
}

// Deterministic JSON output: deep-sorted keys + stable formatting
function sortKeysDeep(x) {
  if (x === null || typeof x !== "object") return x;
  if (Array.isArray(x)) return x.map(sortKeysDeep);
  const out = {};
  for (const k of Object.keys(x).sort()) out[k] = sortKeysDeep(x[k]);
  return out;
}

function nowIso() { return new Date().toISOString(); }

function normalizeBase(u) {
  return String(u || "").replace(/\/+$/, "");
}

function readTextIfExists(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return null; }
}

function readJsonIfExists(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function writeTextIfChanged(p, text) {
  const prev = readTextIfExists(p);
  if (prev === text) return false;
  fs.writeFileSync(p, text, "utf8");
  return true;
}

function writeJsonIfChanged(p, obj) {
  const stableObj = sortKeysDeep(obj);
  const next = JSON.stringify(stableObj, null, 2) + "\n";
  const prev = readTextIfExists(p);
  if (prev === next) return false;
  fs.writeFileSync(p, next, "utf8");
  return true;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "accept": "application/json" } });
  const txt = await res.text();
  let j;
  try { j = JSON.parse(txt); } catch {
    throw new Error(`Non-JSON response ${res.status} from ${url}: ${txt.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}: ${txt.slice(0, 200)}`);
  return j;
}

function basicValidate(payload) {
  const reasons = [];
  const url = (payload?.url || "").trim();
  const title = (payload?.title || "").trim();

  if (!url || !/^https?:\/\//i.test(url)) reasons.push("url_missing_or_invalid");
  if (!title || title.length < 3) reasons.push("title_missing_or_too_short");
  if (title.length > 200) reasons.push("title_too_long");

  const tags = Array.isArray(payload?.tags) ? payload.tags : [];
  if (tags.length > 20) reasons.push("tags_too_many");

  const lang = (payload?.lang || "").trim();
  if (lang && lang.length > 12) reasons.push("lang_invalid");

  return { ok: reasons.length === 0, reasons };
}

async function main() {
  const base = normalizeBase(process.env.AMS_BASE_URL || DEFAULT_BASE);
  const limit = Number(process.env.AMS_LIMIT || "200");

  const outDir = path.join(process.cwd(), "data", "ams");
  const cursorPath = path.join(outDir, "lastCursor.txt");
  const sandboxPath = path.join(outDir, "contrib-sandbox.v1.json");
  const rejectedPath = path.join(outDir, "contrib-rejected.v1.json");

  const lastCursor = (readTextIfExists(cursorPath) || "").trim();

  const params = new URLSearchParams({
    thread: THREAD,
    status: "queued",
    limit: String(limit),
  });
  if (lastCursor) params.set("cursor", lastCursor);

  const url = `${base}/ams/v1/envelopes?${params.toString()}`;
  console.log(`[ingest] ${nowIso()} GET ${url}`);

  const j = await fetchJson(url);
  const items = Array.isArray(j.items) ? j.items : [];
  const nextCursor = String(j.nextCursor || "").trim();

  const prevSandbox = readJsonIfExists(sandboxPath);
  const prevRejected = readJsonIfExists(rejectedPath);

  const sandbox = (prevSandbox && Array.isArray(prevSandbox.items)) ? prevSandbox : {
    ok: true,
    kind: "contrib-sandbox",
    version: "v1",
    updated_at: nowIso(),
    source: { ams_base: base, thread: THREAD },
    items: []
  };

  const rejected = (prevRejected && Array.isArray(prevRejected.items)) ? prevRejected : {
    ok: true,
    kind: "contrib-rejected",
    version: "v1",
    updated_at: nowIso(),
    source: { ams_base: base, thread: THREAD },
    items: []
  };

  // Always normalize source (but we won't churn timestamps unless something changed)
  const prevSandboxUpdatedAt = sandbox.updated_at || null;
  const prevRejectedUpdatedAt = rejected.updated_at || null;

  sandbox.source = { ams_base: base, thread: THREAD };
  rejected.source = { ams_base: base, thread: THREAD };

  const seen = new Set();
  for (const it of sandbox.items) if (it?.canonical_sha256) seen.add(it.canonical_sha256);
  for (const it of rejected.items) if (it?.canonical_sha256) seen.add(it.canonical_sha256);

  let addedSandbox = 0, addedRejected = 0;

  for (const env of items) {
    const payload = env?.payload || {};
    const canonicalObj = {
      url: (payload.url || "").trim(),
      title: (payload.title || "").trim(),
      note: (payload.note || "").trim(),
      lang: (payload.lang || "").trim(),
      tags: Array.isArray(payload.tags) ? payload.tags : [],
      source: payload.source || env?.from || "unknown",
      submitted_at: payload.submitted_at || env?.created_at || null,
      envelope_id: env?.id || null
    };

    const canonicalStr = stableStringify(canonicalObj);
    const canonicalSha = sha256Hex(Buffer.from(canonicalStr, "utf8"));

    if (seen.has(canonicalSha)) continue;
    seen.add(canonicalSha);

    const v = basicValidate(canonicalObj);

    const record = {
      envelope_id: env?.id || null,
      envelope_sha256: env?.sha256 || null,
      payload_sha256: env?.meta?.payload_sha256 || null,
      canonical_sha256: canonicalSha,
      canonical: canonicalObj,
      received_at: env?.created_at || null,
      ingested_at: nowIso()
    };

    if (v.ok) {
      sandbox.items.push(record);
      addedSandbox++;
    } else {
      rejected.items.push({ ...record, reasons: v.reasons });
      addedRejected++;
    }
  }

  // Deterministic ordering of items
  sandbox.items.sort((a, b) => String(a.canonical_sha256).localeCompare(String(b.canonical_sha256)));
  rejected.items.sort((a, b) => String(a.canonical_sha256).localeCompare(String(b.canonical_sha256)));

  // Only bump updated_at if there were real additions OR if file was missing
  const sandboxWasNew = !(prevSandbox && Array.isArray(prevSandbox.items));
  const rejectedWasNew = !(prevRejected && Array.isArray(prevRejected.items));
  const didAdd = (addedSandbox + addedRejected) > 0;

  if (sandboxWasNew || didAdd) sandbox.updated_at = nowIso();
  else sandbox.updated_at = prevSandboxUpdatedAt || sandbox.updated_at || nowIso();

  if (rejectedWasNew || didAdd) rejected.updated_at = nowIso();
  else rejected.updated_at = prevRejectedUpdatedAt || rejected.updated_at || nowIso();

  // Write JSON only if changed (prevents updated_at churn & formatting churn)
  const wroteSandbox = writeJsonIfChanged(sandboxPath, sandbox);
  const wroteRejected = writeJsonIfChanged(rejectedPath, rejected);

  // Cursor: write only if it advanced (prevents cursor churn)
  let wroteCursor = false;
  if (nextCursor && nextCursor !== lastCursor) {
    wroteCursor = writeTextIfChanged(cursorPath, nextCursor + "\n");
  }

  console.log(`[ingest] items_fetched=${items.length} added_sandbox=${addedSandbox} added_rejected=${addedRejected}`);
  console.log(`[ingest] wrote: data/ams/contrib-sandbox.v1.json${wroteSandbox ? "" : " (unchanged)"}`);
  console.log(`[ingest] wrote: data/ams/contrib-rejected.v1.json${wroteRejected ? "" : " (unchanged)"}`);
  console.log(`[ingest] cursor: ${nextCursor ? (nextCursor === lastCursor ? "(unchanged)" : nextCursor) : "(unchanged)"} -> data/ams/lastCursor.txt${wroteCursor ? "" : " (unchanged)"}`);
}

main().catch(err => {
  console.error("[ingest] ERROR:", err?.stack || err);
  process.exit(1);
});