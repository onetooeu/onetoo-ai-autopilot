import test from 'node:test';
import assert from 'node:assert/strict';
import { hardFail } from '../policy/engine/hardFail.js';

const base = {
  schema: 'onetoo.contrib-submission.v2',
  submission_id: 't1',
  submitted_at: '2026-01-06T16:40:00Z',
  author: { id: 'did:tfws:x', pubkey: 'ed25519:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', signature: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==' },
  entry: {
    title: 'Example',
    url: 'https://example.com',
    description: 'd',
    categories: ['AI'],
    canonical: { url: 'https://example.com', lang: 'en' }
  },
  client: { ip_hash: 'sha256:00', ua_hash: 'sha256:00' },
  nonce: 'nonce-12345678',
  protocol: { version: 'tfws-v2', replay_window_sec: 600 }
};

test('hardFail: rejects non-https', () => {
  const s = structuredClone(base);
  s.entry.url = 'http://example.com';
  const hf = hardFail(s, { now: new Date('2026-01-06T16:41:00Z'), replayWindowSec: 600, maxRedirectHops: 2 });
  assert.equal(hf.reject, true);
  assert.ok(hf.reasons.includes('url not https'));
});
