import { verify, hashes } from '@noble/ed25519';

/**
 * Portable SHA-512 backend for noble-ed25519.
 * - Node: uses node:crypto (sync + async)
 * - Workers/Browsers: uses WebCrypto subtle.digest (async)
 */
let nodeCreateHash = null;
try {
  // Top-level await is supported in Node ESM; in Workers this import will fail and is caught.
  const mod = await import('node:crypto');
  nodeCreateHash = mod.createHash;
} catch {}

function bytesFromBase64(b64) {
  // Node
  if (typeof Buffer !== 'undefined') {
    const bin = Buffer.from(b64, 'base64');
    return new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength);
  }
  // Web
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function sha512Sync(message) {
  if (!nodeCreateHash) throw new Error('sha512Sync unavailable (no node:crypto)');
  const buf = nodeCreateHash('sha512').update(Buffer.from(message)).digest();
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

async function sha512Async(message) {
  // Prefer WebCrypto when available (Workers/Browsers)
  if (globalThis.crypto?.subtle?.digest) {
    const ab = await crypto.subtle.digest('SHA-512', message);
    return new Uint8Array(ab);
  }
  // Fallback to Node crypto
  if (nodeCreateHash) return sha512Sync(message);
  throw new Error('No SHA-512 backend available');
}

// Configure noble-ed25519 hashing backends
if (nodeCreateHash) hashes.sha512 = sha512Sync;
hashes.sha512Async = sha512Async;

export function parseEd25519Key(pubkey) {
  // Accept:
  // - "ed25519:BASE64"
  // - "BASE64"
  const s = String(pubkey || '');
  const b64 = s.startsWith('ed25519:') ? s.slice('ed25519:'.length) : s;
  return bytesFromBase64(b64);
}

export function parseEd25519Sig(signatureB64) {
  return bytesFromBase64(signatureB64);
}

export async function verifySignatureRaw(pubkeyBytes, signatureBytes, message) {
  const msgBytes = (typeof message === 'string') ? new TextEncoder().encode(message) : message;
  return await verify(signatureBytes, msgBytes, pubkeyBytes);
}

export async function verifyAuthorSignature(pubkeyBytes, signatureB64, messageStr) {
  const sig = parseEd25519Sig(signatureB64);
  const msgBytes = new TextEncoder().encode(messageStr);
  return await verify(sig, msgBytes, pubkeyBytes);
}

// Utility exported for debugging / fixtures
export const _b64 = { bytesFromBase64, bytesToBase64 };
