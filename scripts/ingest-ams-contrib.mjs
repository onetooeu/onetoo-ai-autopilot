/**
 * Ingest HGPEdu "contrib.submit" envelopes from portal AMS into Autopilot sandbox artifacts.
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
 * Design:
 *  - For status=queued: DO NOT use cursor (queue is a state, cursor semantics are edge-prone).
 *  - For other statuses: use cursor and advance it only when it changes.
 *  - No-churn: write JSON only if content changes; bump updated_at only when items are added or file is created.
 *  - Optional ACK: if AMS_ACK=1 and status=queued, PATCH newly ingested envelopes -> processed (or dry-run via AMS_ACK_DRY=1).
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
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(x[k])).join(",") + "}";
}

// Deterministic JSON output: deep-sorted keys + stable formatting
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

async function fetchJson(url, init = undefined) {
  const res = await fetch(url, {
    ...(init || {}),
    headers: {
      accept: "application/json",
      ...(init?.headers || {}),
    },
  });
  const txt = await res.text();
  let j;
  try {
    j = JSON.parse(txt);
  } catch {
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ackEnvelope({ base, id, toStatus, dryRun, debug }) {
  const url = `${base}/ams/v1/envelopes/${encodeURIComponent(id)}`;
  if (dryRun) {
    console.log(`[ack] DRY PATCH ${url} -> status=${toStatus}`);
    return { ok: true, dry: true };
  }

  // minimal polite retry (transient issues)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const j = await fetchJson(url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: toStatus }),
      });
      if (debug) {
        console.log(`[ack] OK id=${id} status=${j?.envelope?.status || "?"} updated_at=${j?.envelope?.updated_at || "?"}`);
      }
      return { ok: true };
    } catch (e) {
      const msg = String(e?.message || e);
      console.log(`[ack] WARN attempt=${attempt} id=${id} err=${msg.slice(0, 200)}`);
      if (attempt < 3) await sleep(250 * attempt);
      else return { ok: false, error: msg };
    }
  }
  return { ok: false, error: "unknown" };
}

async function main() {
  const base = normalizeBase(process.env.AMS_BASE_URL || DEFAULT_BASE);
  const limit = Number(process.env.AMS_LIMIT || "200");
  const status = String(process.env.AMS_STATUS || "queued").trim() || "queued";

  const ACK = String(process.env.AMS_ACK || "").trim() === "1";
  const ACK_DRY = String(process.env.AMS_ACK_DRY || "").trim() === "1";
  const DEBUG = String(process.env.AMS_DEBUG || "").trim() === "1";

  const outDir = path.join(process.cwd(), "data", "ams");
  fs.mkdirSync(outDir, { recursive: true });

  const cursorPath = path.join(outDir, "lastCursor.txt");
  const sandboxPath = path.join(outDir, "contrib-sandbox.v1.json");
  const rejectedPath = path.join(outDir, "contrib-rejected.v1.json");

  const lastCursor = (readTextIfExists(cursorPath) || "").trim();

  // Cursor policy:
  // - queued: never use cursor
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

  if (DEBUG) {
    console.log(`[debug] fetched_items=${items.length} (showing up to 3)`);
  }

  const prevSandbox = readJsonIfExists(sandboxPath);
  const prevRejected = readJsonIfExists(rejectedPath);

  const sandbox =
    prevSandbox && Array.isArray(prevSandbox.items)
      ? prevSandbox
      : {
          ok: true,
          kind: "contrib-sandbox",
          version: "v1",
          updated_at: nowIso(),
          source: { ams_base: base, thread: THREAD },
          items: [],
        };

  const rejected =
    prevRejected && Array.isArray(prevRejected.items)
      ? prevRejected
      : {
          ok: true,
          kind: "contrib-rejected",
          version: "v1",
          updated_at: nowIso(),
          source: { ams_base: base, thread: THREAD },
          items: [],
        };

  const prevSandboxUpdatedAt = sandbox.updated_at || null;
  const prevRejectedUpdatedAt = rejected.updated_at || null;

  // keep source stable (no extra churn fields)
  sandbox.source = { ams_base: base, thread: THREAD };
  rejected.source = { ams_base: base, thread: THREAD };

  // Dedup: by envelope_id AND canonical_sha256
  const seenEnv = new Set();
  const seenCanon = new Set();

  for (const it of sandbox.items) {
    if (it?.envelope_id) seenEnv.add(it.envelope_id);
    if (it?.canonical_sha256) seenCanon.add(it.canonical_sha256);
  }
  for (const it of rejected.items) {
    if (it?.envelope_id) seenEnv.add(it.envelope_id);
    if (it?.canonical_sha256) seenCanon.add(it.canonical_sha256);
  }

  let addedSandbox = 0,
    addedRejected = 0;

  // collect envelope IDs that were newly ingested (for ACK)
  const ackQueue = [];

  for (const env of items) {
    const envId = env?.id || null;

    const payload = env?.payload || {};
    const canonicalObj = {
      url: (payload.url || "").trim(),
      title: (payload.title || "").trim(),
      note: (payload.note || "").trim(),
      lang: (payload.lang || "").trim(),
      tags: Array.isArray(payload.tags) ? payload.tags : [],
      source: payload.source || env?.from || "unknown",
      submitted_at: payload.submitted_at || env?.created_at || null,
      envelope_id: envId,
    };

    const canonicalStr = stableStringify(canonicalObj);
    const canonicalSha = sha256Hex(Buffer.from(canonicalStr, "utf8"));

    if (DEBUG) {
      console.log(
        `[debug] head id=${envId} created_at=${env?.created_at || ""} env_sha256=${env?.sha256 || ""} canonical_sha256=${canonicalSha}`
      );
    }

    if (envId && seenEnv.has(envId)) {
      if (DEBUG) console.log(`[debug] skip_reason=seen_by_envelope_id envelope_id=${envId} canonical_sha256=${canonicalSha}`);
      continue;
    }
    if (seenCanon.has(canonicalSha)) {
      if (DEBUG) console.log(`[debug] skip_reason=seen_by_canonical_sha256 envelope_id=${envId} canonical_sha256=${canonicalSha}`);
      continue;
    }

    if (envId) seenEnv.add(envId);
    seenCanon.add(canonicalSha);

    const v = basicValidate(canonicalObj);

    const record = {
      envelope_id: envId,
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

    // ACK only makes sense for queued items
    if (status === "queued" && envId) ackQueue.push(envId);
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

  // Cursor: write only if it advanced (prevents cursor churn)
  let wroteCursor = false;
  if (useCursor && nextCursor && nextCursor !== lastCursor) {
    wroteCursor = writeTextIfChanged(cursorPath, nextCursor + "\n");
  }

  console.log(
    `[ingest] status=${status} items_fetched=${items.length} added_sandbox=${addedSandbox} added_rejected=${addedRejected}`
  );
  console.log(`[ingest] wrote: data/ams/contrib-sandbox.v1.json${wroteSandbox ? "" : " (unchanged)"}`);
  console.log(`[ingest] wrote: data/ams/contrib-rejected.v1.json${wroteRejected ? "" : " (unchanged)"}`);
  if (status === "queued") {
    console.log(`[ingest] cursor: (queued: not used) -> data/ams/lastCursor.txt (unchanged)`);
  } else {
    console.log(
      `[ingest] cursor: ${nextCursor ? (nextCursor === lastCursor ? "(unchanged)" : nextCursor) : "(unchanged)"} -> data/ams/lastCursor.txt${
        wroteCursor ? "" : " (unchanged)"
      }`
    );
  }

  // ACK phase (only if we truly added something)
  if (ACK && status === "queued" && ackQueue.length > 0) {
    console.log(`[ack] mode=${ACK_DRY ? "dry" : "live"} count=${ackQueue.length} -> status=processed`);

    // patch sequentially (safe + readable logs)
    let ok = 0,
      fail = 0;
    for (const id of ackQueue) {
      const r = await ackEnvelope({
        base,
        id,
        toStatus: "processed",
        dryRun: ACK_DRY,
        debug: DEBUG,
      });
      if (r.ok) ok++;
      else fail++;
    }
    console.log(`[ack] done ok=${ok} fail=${fail}`);
  } else if (ACK && status === "queued") {
    console.log(`[ack] enabled but nothing new to ack`);
  }

  if (DEBUG) {
    // helpful hint when queue has duplicates
    console.log(`[debug] didAdd=${didAdd}`);
  }
}

main().catch((err) => {
  console.error("[ingest] ERROR:", err?.stack || err);
  process.exit(1);
});