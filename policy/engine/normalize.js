// Deterministic JSON canonicalization (stable stringify with sorted keys).
// NOTE: This is NOT RFC8785. It's a simple, reproducible approach for TFWS-style artifacts.
// Rule: objects => keys sorted lexicographically; arrays keep order; no undefined.

export function canonicalize(value) {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(sortDeep);
  const out = {};
  const keys = Object.keys(v).sort();
  for (const k of keys) {
    const vv = v[k];
    if (vv === undefined) continue;
    out[k] = sortDeep(vv);
  }
  return out;
}

export function nowIso(d = new Date()) {
  return d.toISOString();
}
