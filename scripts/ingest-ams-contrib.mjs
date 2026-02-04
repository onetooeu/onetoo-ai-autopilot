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

// Deterministic JSON stringify: stable key order
function stableStringify(x) {
  if (x === null || typeof x !== "object") return JSON.stringify(x);
  if (Array.isArray(x)) return "[" + x.map(stableStringify).join(",") + "]";
  const keys = Object.keys(x).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(x[k])).join(",") + "}";
}

function nowIso() { return new Date().toISOString(); }

function readTextIfExists(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return null; }
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "accept": "application/json" }});
  const txt = await res.text();
  let j;
  try { j = JSON.parse(txt); } catch {
    throw new Error(`Non-JSON response ${res.status} from ${url}: ${txt.slice(0,200)}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}: ${txt.slice(0,200)}`);
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
  const base = process.env.AMS_BASE_URL || DEFAULT_BASE;
  const limit = Number(process.env.AMS_LIMIT || "200");

  const outDir = path.join(process.cwd(), "data", "ams");
  const cursorPath = path.join(outDir, "lastCursor.txt");
  const sandboxPath = path.join(outDir, "contrib-sandbox.v1.json");
  const rejectedPath = path.join(outDir, "contrib-rejected.v1.json");

  const lastCursor = (readTextIfExists(cursorPath) || "").trim();
  const params = new URLSearchParams({ thread: THREAD, status: "queued", limit: String(limit) });
  if (lastCursor) params.set("cursor", lastCursor);

  const url = `${base}/ams/v1/envelopes?${params.toString()}`;
  console.log(`[ingest] ${nowIso()} GET ${url}`);

  const j = await fetchJson(url);
  const items = Array.isArray(j.items) ? j.items : [];
  const nextCursor = (j.nextCursor || "").trim();

  const prevSandbox = (() => { try { return JSON.parse(fs.readFileSync(sandboxPath, "utf8")); } catch { return null; } })();
  const prevRejected = (() => { try { return JSON.parse(fs.readFileSync(rejectedPath, "utf8")); } catch { return null; } })();

  const sandbox = prevSandbox && Array.isArray(prevSandbox.items) ? prevSandbox : {
    ok: true,
    kind: "contrib-sandbox",
    version: "v1",
    updated_at: nowIso(),
    source: { ams_base: base, thread: THREAD },
    items: []
  };

  const rejected = prevRejected && Array.isArray(prevRejected.items) ? prevRejected : {
    ok: true,
    kind: "contrib-rejected",
    version: "v1",
    updated_at: nowIso(),
    source: { ams_base: base, thread: THREAD },
    items: []
  };

  const seen = new Set();
  for (const it of sandbox.items) seen.add(it.canonical_sha256);
  for (const it of rejected.items) seen.add(it.canonical_sha256);

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
      envelope_id: env?.id,
      envelope_sha256: env?.sha256 || null,
      payload_sha256: env?.meta?.payload_sha256 || null,
      canonical_sha256: canonicalSha,
      canonical: canonicalObj,
      received_at: env?.created_at || null,
      ingested_at: nowIso()
    };

    if (v.ok) { sandbox.items.push(record); addedSandbox++; }
    else { rejected.items.push({ ...record, reasons: v.reasons }); addedRejected++; }
  }

  sandbox.updated_at = nowIso();
  rejected.updated_at = nowIso();
  sandbox.items.sort((a,b)=>a.canonical_sha256.localeCompare(b.canonical_sha256));
  rejected.items.sort((a,b)=>a.canonical_sha256.localeCompare(b.canonical_sha256));

  writeJson(sandboxPath, sandbox);
  writeJson(rejectedPath, rejected);
  if (nextCursor) fs.writeFileSync(cursorPath, nextCursor + "\n", "utf8");

  console.log(`[ingest] items_fetched=${items.length} added_sandbox=${addedSandbox} added_rejected=${addedRejected}`);
  console.log(`[ingest] wrote: data/ams/contrib-sandbox.v1.json`);
  console.log(`[ingest] wrote: data/ams/contrib-rejected.v1.json`);
  console.log(`[ingest] cursor: ${nextCursor || "(unchanged)"} -> data/ams/lastCursor.txt`);
}

main().catch(err => {
  console.error("[ingest] ERROR:", err?.stack || err);
  process.exit(1);
});
