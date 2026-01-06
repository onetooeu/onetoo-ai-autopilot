import { URL } from 'node:url';

export function computeSignals(submission, ctx) {
  const entryUrl = new URL(submission.entry.url);
  const canonicalUrl = new URL(submission.entry.canonical.url);

  const signals = {};

  // Reputation: deterministic from provided history (counts)
  const hist = ctx.authorHistory?.[submission.author.id] ?? { accepted: 0, rejected: 0, quarantined: 0 };
  signals.author_reputation = Math.max(0, Math.min(25, hist.accepted * 5 - hist.rejected * 2));

  // TFWS discovery (provided by urlProbe/discovery)
  const d = ctx.discovery ?? {};
  const tfwsPresent = !!(d.tfws_present || d.ai_signal || d.ai_trust || d.trust);
  signals.tfws_presence = tfwsPresent ? 25 : 0;

  // Transport/security from probe
  const p = ctx.urlProbe ?? { https_ok: false, hops: 0, host_changed: false, used_http: false, hsts: false };
  signals.transport_security = p.https_ok ? (p.hsts ? 10 : 7) : 0;

  // Canonical sanity: host match & lengths
  let cs = 0;
  if (entryUrl.protocol === 'https:' && canonicalUrl.protocol === 'https:') cs += 5;
  if (entryUrl.host === canonicalUrl.host) cs += 5;
  if ((submission.entry.title?.length ?? 0) <= (ctx.policy?.max_title_length ?? 140)) cs += 3;
  if ((submission.entry.description?.length ?? 0) <= (ctx.policy?.max_description_length ?? 280)) cs += 2;
  signals.canonical_sanity = cs;

  // Tracking cleanliness
  const trackParams = new Set(ctx.policy?.track_params ?? []);
  let hasTracking = false;
  for (const [k] of entryUrl.searchParams) {
    if (trackParams.has(k)) {
      hasTracking = true;
      break;
    }
  }
  signals.tracking_cleanliness = hasTracking ? 0 : 10;

  // Redirect risk
  let rr = 10;
  if (p.hops > 0) rr -= Math.min(10, p.hops * 4);
  if (p.host_changed) rr -= 6;
  if (p.used_http) rr = 0;
  signals.redirect_risk = Math.max(0, rr);

  // TLD risk (provided by ctx.tldRisk)
  const tld = entryUrl.hostname.split('.').pop() || '';
  const risk = ctx.tldRisk?.[tld] ?? 0;
  signals.tld_risk = Math.max(0, Math.min(5, 5 - risk));

  return signals;
}
