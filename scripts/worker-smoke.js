import worker from '../services/worker/src/worker.js';
import { canonicalize } from '../policy/engine/normalize.js';
import { getPublicKey, sign, hashes } from '@noble/ed25519';
import { createHash } from 'node:crypto';

// Provide sha512 backend for @noble/ed25519 using Node crypto
hashes.sha512 = (msg) => new Uint8Array(createHash('sha512').update(msg).digest());


function bytesToB64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

// Deterministic test key (32 bytes)
const priv = new Uint8Array(32);
priv.fill(7);
const pub = await getPublicKey(priv);

const submission = {
  schema: 'onetoo.contrib-submission.v2',
  submission_id: 'smoke-0001',
  submitted_at: new Date().toISOString(),
  author: { id: 'did:tfws:test', pubkey: 'ed25519:' + bytesToB64(pub), signature: '' },
  entry: {
    title: 'Example',
    url: 'https://example.com',
    description: 'Example description OK',
    categories: ['AI'],
    canonical: { url: 'https://example.com', lang: 'en' }
  },
  client: { ip_hash: 'sha256:00', ua_hash: 'sha256:00' },
  nonce: 'nonce-12345678',
  protocol: { version: 'tfws-v2', replay_window_sec: 600 }
};

// Signature message must match policy/engine/evaluate.js canonicalMessage()
const msg = {
  submission_id: submission.submission_id,
  submitted_at: submission.submitted_at,
  author_id: submission.author.id,
  entry: submission.entry,
  nonce: submission.nonce,
  protocol: submission.protocol
};

const msgStr = canonicalize(msg);
const sig = await sign(new TextEncoder().encode(msgStr), priv);
submission.author.signature = bytesToB64(sig);

const req = new Request('https://autopilot.local/contrib/v2/submit', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(submission)
});

const res = await worker.fetch(req, { ...process.env }, {});
console.log('Status:', res.status);
console.log(await res.text());
