export function buildReasons(hardFailReasons, signals, decision) {
  const reasons = [...hardFailReasons];

  const pushIf = (cond, msg) => { if (cond) reasons.push(msg); };

  pushIf(signals.author_reputation <= 5, 'new author: no prior stable acceptances');
  pushIf(signals.tfws_presence >= 20, 'domain publishes TFWS discovery endpoints');
  pushIf(signals.tracking_cleanliness <= 0, 'tracking parameters detected or unknown');
  pushIf(signals.redirect_risk < 0, 'redirect chain detected');
  pushIf(decision === 'sandbox', 'sandbox lane: visible but untrusted');
  pushIf(decision === 'stable', 'stable lane: accepted into signed set');

  return reasons.slice(0, 32); // keep bounded
}
