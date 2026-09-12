// Encrypts the wallet's backup hex at rest using a PIN-derived key, so the seed never sits in
// plaintext localStorage once a PIN has been set. AES-GCM's auth tag is what lets decryptWithPin
// tell "wrong PIN" apart from any other failure — a wrong key fails the tag check, not just
// producing garbage plaintext.
const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface EncryptedBlob {
  ct: string;
  iv: string;
  salt: string;
}

export const MIN_PIN_LENGTH = 4;

function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptWithPin(plaintext: string, pin: string): Promise<EncryptedBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(pin, salt);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, new TextEncoder().encode(plaintext));
  return { ct: toB64(new Uint8Array(ct)), iv: toB64(iv), salt: toB64(salt) };
}

/** Returns null on a wrong PIN (GCM tag mismatch) rather than throwing. */
export async function decryptWithPin(blob: EncryptedBlob, pin: string): Promise<string | null> {
  try {
    const key = await deriveKey(pin, fromB64(blob.salt));
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(blob.iv) as BufferSource },
      key,
      fromB64(blob.ct) as BufferSource,
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}
