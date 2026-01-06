import fs from 'node:fs';
import path from 'node:path';

function nowIso() {
  return new Date().toISOString();
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", 'utf8');
}

function normalizeUrl(u) {
  try {
    const url = new URL(u);
    // normalize: lowercase host, strip trailing slash for path-only root? keep as-is except host.
    url.host = url.host.toLowerCase();
    return url.toString();
  } catch {
    return u;
  }
}

function ensureShape(doc, schema, policyVersion) {
  if (!doc || typeof doc !== 'object') throw new Error('invalid doc');
  if (doc.schema !== schema) {
    // allow empty/new docs
    doc.schema = schema;
  }
  doc.policy_version = doc.policy_version || policyVersion;
  doc.entries = Array.isArray(doc.entries) ? doc.entries : [];
  return doc;
}

function existsByUrl(entries, url) {
  const n = normalizeUrl(url);
  return entries.some(e => normalizeUrl(e?.entry?.url || e?.url) === n);
}

// Usage:
//   node scripts/apply-proposal.js proposals/<id>.json
const proposalPath = process.argv[2];
if (!proposalPath) {
  console.error('Usage: node scripts/apply-proposal.js <proposal.json>');
  process.exit(2);
}

const repoRoot = process.cwd();
const proposal = readJson(proposalPath);

// minimal validation
if (!proposal.submission_id || !proposal.entry || !proposal.decision) {
  throw new Error('proposal missing required fields: submission_id, entry, decision');
}

const policyVersion = proposal.policy_version || '2026-01-autopilot-01';

const sandboxPath = path.join(repoRoot, 'data', 'sandbox', 'contrib-sandbox.v2.json');
const stablePath = path.join(repoRoot, 'data', 'stable', 'contrib-accepted.v2.json');

const sandboxDoc = ensureShape(readJson(sandboxPath), 'onetoo.contrib-sandbox.v2', policyVersion);
const stableDoc = ensureShape(readJson(stablePath), 'onetoo.contrib-accepted.v2', policyVersion);

// Always add to sandbox if not duplicate
if (!existsByUrl(sandboxDoc.entries, proposal.entry.url)) {
  sandboxDoc.entries.push({
    lane: 'sandbox',
    submission_id: proposal.submission_id,
    decided_at: proposal.decided_at || nowIso(),
    decision: proposal.decision,
    score: proposal.score ?? null,
    threshold: proposal.threshold ?? null,
    policy_version: policyVersion,
    reasons: Array.isArray(proposal.reasons) ? proposal.reasons : [],
    entry: proposal.entry
  });
}

if (proposal.decision === 'stable') {
  if (!existsByUrl(stableDoc.entries, proposal.entry.url)) {
    stableDoc.entries.push({
      accepted_at: nowIso(),
      accepted_by: 'autopilot',
      policy_version: policyVersion,
      score: proposal.score ?? null,
      reasons: Array.isArray(proposal.reasons) ? proposal.reasons : [],
      submission_id: proposal.submission_id,
      entry: proposal.entry
    });
  }
}

sandboxDoc.generated_at = nowIso();
stableDoc.generated_at = nowIso();

writeJson(sandboxPath, sandboxDoc);
writeJson(stablePath, stableDoc);

console.log('OK: applied proposal', proposal.submission_id, 'decision=', proposal.decision);
