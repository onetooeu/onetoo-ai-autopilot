import { evaluateSubmission } from '../../../policy/engine/evaluate.js';
import defaultPolicy from '../../../policy/config/policy-config.js';
function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function getPolicy(env) {
  if (env?.POLICY_CONFIG) {
    try { return JSON.parse(env.POLICY_CONFIG); } catch {
      return defaultPolicy;
    }
  }
  return defaultPolicy;
}


async function maybeCreateProposalIssue(env, proposal) {
  const repo = env?.GITHUB_REPO;
  const token = env?.GITHUB_TOKEN;
  if (!repo || !token) return { ok: false, reason: 'github not configured' };

  const api = `https://api.github.com/repos/${repo}/issues`;
  const title = `proposal:${proposal.submission_id}`;
  const body = JSON.stringify(proposal, null, 2);

  const resp = await fetch(api, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${token}`,
      'accept': 'application/vnd.github+json',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ title, body, labels: ['proposal'] })
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    return { ok: false, reason: `github issue create failed: ${resp.status}`, details: t.slice(0, 2000) };
  }
  const j = await resp.json().catch(() => ({}));
  return { ok: true, issue_number: j.number, url: j.html_url };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/healthz' || url.pathname === '/health') {
      return json({ ok: true, service: 'onetoo-ai-autopilot-worker' });
    }

    if (url.pathname === '/openapi.json') {
      return json({
        openapi: '3.0.3',
        info: { title: 'onetoo-ai-autopilot', version: '0.1.0' },
        paths: {
          '/contrib/v2/submit': { post: { summary: 'Submit contribution (autopilot decision)' } },
          '/healthz': { get: { summary: 'Health check' } }
        }
      });
    }

    if (url.pathname === '/contrib/v2/submit' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'invalid json' }, 400);
      }

      const policyConfig = getPolicy(env);
      const decision = await evaluateSubmission(body, {
        policyConfig,
        now: new Date(),
        // In production: fill these from storage + probes
        replayWindowSec: policyConfig.replay_window_sec,
        maxRedirectHops: policyConfig.max_redirect_hops,
        blockedCategories: new Set((env?.BLOCKED_CATEGORIES || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)),
        blockedHosts: new Set((env?.BLOCKED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)),
        tldRisk: {}
      });

      // Proposal payload is what the GitHub Action consumes when fully-autonomous.
      const proposal = {
        schema: 'onetoo.contrib-proposal.v2',
        submission_id: decision.submission_id,
        decision: decision.decision,
        score: decision.score,
        threshold: decision.threshold,
        policy_version: decision.policy_version,
        reasons: decision.reasons,
        decided_at: decision.decided_at,
        submission: body
      };

      let github = undefined;
      if (decision.decision === 'stable') {
        github = await maybeCreateProposalIssue(env, proposal);
      }

      const out = github ? { ...decision, github } : decision;
      return json(out, decision.decision === 'reject' ? 400 : 200);

    }

    return json({ error: 'not found' }, 404);
  }
};
