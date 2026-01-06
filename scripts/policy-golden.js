import fs from 'node:fs';
import path from 'node:path';
import { evaluateSubmission } from '../policy/engine/evaluate.js';

const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'policy', 'config', 'policy-config.json'), 'utf8'));

const dir = path.join(process.cwd(), 'policy', 'fixtures');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
let ok = true;

for (const f of files) {
  const fx = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

  const ctx = {
    ...fx.ctx,
    policyConfig: cfg,
    skipSignature: true
  };

  // Map a few optional knobs used by hardFail
  ctx.blockedCategories = new Set();
  ctx.blockedHosts = new Set();

  // Normalise now
  if (typeof ctx.now === 'string') ctx.now = new Date(ctx.now);

  const res = await evaluateSubmission(fx.submission, ctx);
  const exp = fx.expect;

  const decisionOk = res.decision === exp.decision;
  const scoreOk = exp.minScore !== undefined ? res.score >= exp.minScore : (exp.score !== undefined ? res.score === exp.score : true);

  if (!decisionOk || !scoreOk) {
    ok = false;
    console.error(`Fixture failed: ${fx.name}`);
    console.error('Expected:', exp);
    console.error('Got     :', { decision: res.decision, score: res.score, reasons: res.reasons, signals: res.signals, hardFailReasons: res.hardFailReasons });
  } else {
    console.log(`OK: ${fx.name} -> ${res.decision} (${res.score})`);
  }
}

if (!ok) process.exit(1);
console.log(`OK: ${files.length} golden fixtures`);
