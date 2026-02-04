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
 *
 * Design / No-churn rules:
 *  - status=queued: DO NOT use cursor (queue is stateful; cursor semantics are edge-prone at boundaries).
 *  - status!=queued: use cursor if present; advance it only when it changes.
 *  - Write JSON only if content changes (prevents formatting/updated_at churn).
 *  - Bump updated_at only when items are added or file is created.
 *  - Keep "source" stable (no status in JSON) to avoid permanent one-field churn.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_BASE = "https://portal.onetoo.eu";
const THREAD = "t_contrib_submit";

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// Deterministic JSON stringify for canonical hashing only (stable key order)
function stableStringify(x) {
  if (x === null || typeof x !== "object") return JSON.stringify(x);
  if (Array.isArray(x)) return "[" + x.map(stableStringify).join(",") + "]";
  const keys = Object.keys(x).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(x[k])).join(",") + "}";
}

// Deterministic JSON output: deep-sorted keys (stable file content)
function sortKeysDeep(x) {
  if (x === null || typeof x !== "object") return x;
  if (Array.isArray(x)) return x.map(sortKeysDeep);
  const out = {};
  for (const k of Object.keys(x).sort()) out[k] = sortKeysDeep(x[k]);
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeBase(u) {
  return String(u || "").replace(/\/+$/, "");
}

function readTextIfExists(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function readJsonIfExists(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
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
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const txt = await res.text();

  let j;
  try {
    j = JSON.parse(txt);
  } catch {
    throw new Error(`Non-JSON response ${res.status} from ${url}: ${txt.slice(0, 200)}`);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}: ${txt.slice(0, 200)}`);
  }

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

function makeEmptyArtifact(kind, base) {
  return {
    ok: true,
    kind,
    version: "v1",
    updated_at: nowIso(),
    source: { ams_base: base, thread: THREAD },
    items: [],
  };
}

async function main() {
  const base = normalizeBase(process.env.AMS_BASE_URL || DEFAULT_BASE);
  const limit = Number(process.env.AMS_LIMIT || "200");
  const status = String(process.env.AMS_STATUS || "queued").trim() || "queued";

  const outDir = path.join(process.cwd(), "data", "ams");
  fs.mkdirSync(outDir, { recursive: true });

  const cursorPath = path.join(outDir, "lastCursor.txt");
  const sandboxPath = path.join(outDir, "contrib-sandbox.v1.json");
  const rejectedPath = path.join(outDir, "contrib-rejected.v1.json");

  const lastCursor = (readTextIfExists(cursorPath) || "").trim();

  // Cursor policy:
  // - queued: never use cursor (queue is a state, cursor boundaries can hide items at equal timestamps)
  // - otherwise: use cursor if present
  const useCursor = status !== "queued" && !!lastCursor;

  const params = new URLSearchParams({
    thread: THREAD,
    status,
    limit: String(limit),
  });
  if (useCursor) params.set("cursor", lastCursor);

  const url = `${base}/ams/v1/envelopes?${params.toString()}`;
  console.log(`[ingest] ${nowIso()} GET ${url}`);

  const j = await fetchJson(url);
  const items = Array.isArray(j.items) ? j.items : [];
  const nextCursor = String(j.nextCursor || "").trim();

  const prevSandbox = readJsonIfExists(sandboxPath);
  const prevRejected = readJsonIfExists(rejectedPath);

  const sandbox =
    prevSandbox && Array.isArray(prevSandbox.items)
      ? prevSandbox
      : makeEmptyArtifact("contrib-sandbox", base);

  const rejected =
    prevRejected && Array.isArray(prevRejected.items)
      ? prevRejected
      : makeEmptyArtifact("contrib-rejected", base);

  // Keep source stable (no status in JSON)
  const prevSandboxUpdatedAt = sandbox.updated_at || null;
  const prevRejectedUpdatedAt = rejected.updated_at || null;
  sandbox.source = { ams_base: base, thread: THREAD };
  rejected.source = { ams_base: base, thread: THREAD };

  const seen = new Set();
  for (const it of sandbox.items) if (it?.canonical_sha256) seen.add(it.canonical_sha256);
  for (const it of rejected.items) if (it?.canonical_sha256) seen.add(it.canonical_sha256);

  let addedSandbox = 0;
  let addedRejected = 0;

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
      envelope_id: env?.id || null,
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
      ingested_at: nowIso(),
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

  const sandboxWasNew = !(prevSandbox && Array.isArray(prevSandbox.items));
  const rejectedWasNew = !(prevRejected && Array.isArray(prevRejected.items));
  const didAdd = addedSandbox + addedRejected > 0;

  if (sandboxWasNew || didAdd) sandbox.updated_at = nowIso();
  else sandbox.updated_at = prevSandboxUpdatedAt || sandbox.updated_at || nowIso();

  if (rejectedWasNew || didAdd) rejected.updated_at = nowIso();
  else rejected.updated_at = prevRejectedUpdatedAt || rejected.updated_at || nowIso();

  const wroteSandbox = writeJsonIfChanged(sandboxPath, sandbox);
  const wroteRejected = writeJsonIfChanged(rejectedPath, rejected);

  // Cursor handling:
  // - queued: never advance cursor based on queued results
  // - otherwise: write only if it changed
  let wroteCursor = false;
  if (status !== "queued") {
    if (nextCursor && nextCursor !== lastCursor) {
      wroteCursor = writeTextIfChanged(cursorPath, nextCursor + "\n");
    }
  }

  console.log(`[ingest] status=${status} items_fetched=${items.length} added_sandbox=${addedSandbox} added_rejected=${addedRejected}`);
  console.log(`[ingest] wrote: data/ams/contrib-sandbox.v1.json${wroteSandbox ? "" : " (unchanged)"}`);
  console.log(`[ingest] wrote: data/ams/contrib-rejected.v1.json${wroteRejected ? "" : " (unchanged)"}`);

  if (status === "queued") {
    console.log(`[ingest] cursor: (queued: not used) -> data/ams/lastCursor.txt (unchanged)`);
  } else {
    console.log(
      `[ingest] cursor: ${nextCursor ? (nextCursor === lastCursor ? "(unchanged)" : nextCursor) : "(unchanged)"} -> data/ams/lastCursor.txt${wroteCursor ? "" : " (unchanged)"}`
    );
  }
}

main().catch((err) => {
  console.error("[ingest] ERROR:", err?.stack || err);
  process.exit(1);
});