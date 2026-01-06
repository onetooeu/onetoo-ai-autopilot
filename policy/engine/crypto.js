import { verify } from '@noble/ed25519';

function b64ToBytes(b64) {
  const bin = Buffer.from(b64, 'base64');
  return new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength);
}

export function parseEd25519Key(pubkey) {
  // Accept: "ed25519:BASE64" or raw BASE64.
  const p = pubkey.startsWith('ed25519:') ? pubkey.slice('ed25519:'.length) : pubkey;
  const bytes = b64ToBytes(p);
  if (bytes.length !== 32) throw new Error(`Invalid ed25519 pubkey length: ${bytes.length}`);
  return bytes;
}

export function parseEd25519Sig(sig) {
  const s = sig.startsWith('base64:') ? sig.slice('base64:'.length) : sig;
  const bytes = b64ToBytes(s);
  if (bytes.length !== 64) throw new Error(`Invalid ed25519 signature length: ${bytes.length}`);
  return bytes;
}

export async function verifyEd25519({ message, pubkey, signature }) {
  const pk = parseEd25519Key(pubkey);
  const sig = parseEd25519Sig(signature);
  const msgBytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;
  return await verify(sig, msgBytes, pk);
}

export async function verifyAuthorSignature(pubkeyBytes, signatureB64, messageStr) {
  const sig = parseEd25519Sig(signatureB64);
  const msgBytes = new TextEncoder().encode(messageStr);
  return await verify(sig, msgBytes, pubkeyBytes);
}
