import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { canonicalize, nowIso } from './normalize.js';
import { parseEd25519Key, verifyAuthorSignature } from './crypto.js';
import { hardFail } from './hardFail.js';
import { computeSignals } from './signals.js';
import { scoreFromSignals, decideLane } from './score.js';
import { buildReasons } from './reasons.js';

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const schemaPath = path.join(process.cwd(), 'schemas', 'contrib-submission.v2.schema.json');
const submissionSchema = ajv.compile(JSON.parse(fs.readFileSync(schemaPath, 'utf8')));

export function makeSignedMessage(submission) {
  const msg = {
    submission_id: submission.submission_id,
    submitted_at: submission.submitted_at,
    author_id: submission.author.id,
    entry: submission.entry,
    nonce: submission.nonce,
    protocol: submission.protocol
  };
  return canonicalize(msg);
}

export async function evaluateSubmission(submission, ctx) {
  const cfg = ctx.policyConfig;

  if (!submissionSchema(submission)) {
    return {
      decision: 'reject',
      score: 0,
      hardFailReasons: ['schema validation failed'],
      schemaErrors: submissionSchema.errors
    };
  }

  if (!ctx.skipSignature) {
    let sigOk = false;
    try {
      const pub = parseEd25519Key(submission.author.pubkey);
      const msg = makeSignedMessage(submission);
      sigOk = await verifyAuthorSignature(pub, submission.author.signature, msg);
    } catch {
      sigOk = false;
    }
    if (!sigOk) {
      return { decision: 'reject', score: 0, hardFailReasons: ['invalid author signature'] };
    }
  }

  const hf = hardFail(submission, {
    ...ctx,
    replayWindowSec: cfg.replay_window_sec,
    maxRedirectHops: cfg.max_redirect_hops
  });
  if (hf.reject) {
    return { decision: 'reject', score: 0, hardFailReasons: hf.reasons };
  }

  const signals = computeSignals(submission, { ...ctx, policy: cfg });
  const score = scoreFromSignals(signals, cfg);
  const decision = decideLane(score, false, cfg);
  const reasons = buildReasons(hf.reasons, signals, decision);

  return {
    schema: 'onetoo.contrib-decision.v2',
    submission_id: submission.submission_id,
    decision,
    score,
    threshold: cfg.threshold_stable,
    policy_version: cfg.policy_version,
    signals,
    reasons,
    decided_at: nowIso(ctx.now ?? new Date()),
    decided_by: 'autopilot'
  };
}
