import worker from '../services/worker/src/worker.js';

const submission = {
  schema: 'onetoo.contrib-submission.v2',
  submission_id: 'smoke-1',
  submitted_at: new Date().toISOString(),
  author: { id: 'did:tfws:test', pubkey: 'ed25519:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', signature: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==' },
  entry: { title: 'Example', url: 'https://example.com', description: 'Example', categories: ['AI'], canonical: { url: 'https://example.com', lang: 'en' } },
  client: { ip_hash: 'sha256:00', ua_hash: 'sha256:00' },
  nonce: 'nonce-12345678',
  protocol: { version: 'tfws-v2', replay_window_sec: 600 }
};

const req = new Request('https://autopilot.local/contrib/v2/submit', { method: 'POST', body: JSON.stringify(submission) });
const res = await worker.fetch(req, { ...process.env }, {});
console.log('Status:', res.status);
console.log(await res.text());
