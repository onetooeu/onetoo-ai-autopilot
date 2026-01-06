export function scoreFromSignals(signals, cfg) {
  // Each signal already encoded as points; clamp 0..100 at end.
  let total = 0;
  for (const k of Object.keys(signals)) total += signals[k];
  total = Math.max(0, Math.min(100, Math.round(total)));
  return total;
}

export function decideLane(score, hardFailRejected, cfg) {
  if (hardFailRejected) return 'reject';
  if (score >= cfg.threshold_stable) return 'stable';
  return 'sandbox';
}
