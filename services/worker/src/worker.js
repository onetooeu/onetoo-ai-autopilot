import { evaluateSubmission } from '../../../policy/engine/evaluate.js';
import defaultPolicy from '../../../policy/config/policy-config.json' assert { type: 'json' };

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

      return json(decision, decision.decision === 'reject' ? 400 : 200);
    }

    return json({ error: 'not found' }, 404);
  }
};
