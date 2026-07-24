/**
 * Application-layer AES-256-GCM encryption for stored OAuth tokens.
 *
 * Envelope format (binary, then base64-encoded for TEXT column storage):
 *   [version: 1 byte][nonce: 12 bytes][ciphertext: variable][authTag: 16 bytes]
 *
 * The version byte allows future key rotation without downtime: re-encrypt
 * existing rows using the new key under a new version byte, then retire the
 * old key once all rows are migrated.
 *
 * Key source: OAUTH_TOKEN_ENCRYPTION_KEY env var — 32 random bytes,
 * base64-encoded (generate with: node -e "require('crypto').randomBytes(32).toString('base64')")
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const VERSION = 0x01;
const ALGO = "aes-256-gcm" as const;
const NONCE_LEN = 12;
const TAG_LEN = 16;
const ENVELOPE_OVERHEAD = 1 + NONCE_LEN + TAG_LEN;

function getKey(): Buffer {
  const raw = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "Missing required environment variable: OAUTH_TOKEN_ENCRYPTION_KEY",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `OAUTH_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}). ` +
        "Generate with: node -e \"require('crypto').randomBytes(32).toString('base64')\"",
    );
  }
  return key;
}

/**
 * Returns true if the stored value looks like a v1 encrypted envelope.
 * Used by the migration script to skip already-encrypted rows.
 */
export function isEncrypted(value: string): boolean {
  try {
    const buf = Buffer.from(value, "base64");
    return buf.length > ENVELOPE_OVERHEAD && buf[0] === VERSION;
  } catch {
    return false;
  }
}

/**
 * Encrypts a plaintext OAuth token string and returns a base64-encoded
 * envelope safe for storage in a TEXT column.
 */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv(ALGO, key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const envelope = Buffer.concat([
    Buffer.from([VERSION]),
    nonce,
    ciphertext,
    tag,
  ]);
  return envelope.toString("base64");
}

/**
 * Decrypts a base64-encoded envelope produced by encryptToken.
 * Throws a descriptive error if the ciphertext is malformed, the auth tag
 * fails (tampered data), or the key is wrong — never returns empty/garbled data.
 */
export function decryptToken(ciphertext: string): string {
  const envelope = Buffer.from(ciphertext, "base64");

  if (envelope.length <= ENVELOPE_OVERHEAD) {
    throw new Error(
      `token-encryption: envelope too short (${envelope.length} bytes) — not a valid encrypted token`,
    );
  }
  if (envelope[0] !== VERSION) {
    throw new Error(
      `token-encryption: unknown version byte 0x${envelope[0]?.toString(16)} — ` +
        "expected 0x01. Run the encrypt-oauth-tokens migration if this is a plaintext legacy token.",
    );
  }

  const key = getKey();
  const nonce = envelope.slice(1, 1 + NONCE_LEN);
  const tag = envelope.slice(envelope.length - TAG_LEN);
  const ct = envelope.slice(1 + NONCE_LEN, envelope.length - TAG_LEN);

  try {
    const decipher = createDecipheriv(ALGO, key, nonce);
    decipher.setAuthTag(tag);
    return decipher.update(ct).toString("utf8") + decipher.final("utf8");
  } catch (err) {
    throw new Error(
      `token-encryption: decryption failed — wrong key or tampered ciphertext (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }
}
