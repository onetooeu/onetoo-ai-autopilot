import { URL } from 'node:url';

export function hardFail(submission, ctx) {
  const reasons = [];

  // Timestamp replay window
  const submittedAt = new Date(submission.submitted_at);
  if (Number.isNaN(submittedAt.getTime())) {
    reasons.push('malformed submitted_at');
    return { reject: true, reasons };
  }
  const now = ctx.now ?? new Date();
  const diff = Math.abs(now.getTime() - submittedAt.getTime()) / 1000;
  if (diff > ctx.replayWindowSec) {
    reasons.push('timestamp outside replay window');
    return { reject: true, reasons };
  }

  // URL https
  let u;
  try {
    u = new URL(submission.entry.url);
  } catch {
    reasons.push('malformed url');
    return { reject: true, reasons };
  }
  if (u.protocol !== 'https:') {
    reasons.push('url not https');
    return { reject: true, reasons };
  }

  // Redirect rules from probe (filled by worker or tests)
  const probe = ctx.urlProbe;
  if (probe) {
    if (probe.hops > ctx.maxRedirectHops) {
      reasons.push(`redirect chain too long (${probe.hops})`);
      return { reject: true, reasons };
    }
    if (probe.hostChanged) {
      reasons.push('redirect changes host');
      return { reject: true, reasons };
    }
    if (probe.usedHttp) {
      reasons.push('redirect uses http');
      return { reject: true, reasons };
    }
  }

  // Duplicate URL (store provides)
  if (ctx.isDuplicateUrl?.(submission.entry.canonical.url ?? submission.entry.url)) {
    reasons.push('duplicate url');
    return { reject: true, reasons };
  }

  // Blocked categories
  const cats = submission.entry.categories || [];
  for (const c of cats) {
    if (ctx.blockedCategories?.has(c.toLowerCase())) {
      reasons.push(`blocked category: ${c}`);
      return { reject: true, reasons };
    }
  }

  // Blocked hosts
  if (ctx.blockedHosts?.has(u.hostname.toLowerCase())) {
    reasons.push('blocked host');
    return { reject: true, reasons };
  }

  return { reject: false, reasons };
}
