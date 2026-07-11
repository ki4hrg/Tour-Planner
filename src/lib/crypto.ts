import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

// At-rest encryption for third-party secrets (Todoist tokens). AES-256-GCM with
// a key derived from AUTH_SECRET — no extra key material to provision, and the
// stored value is useless without the app's secret. Never send decrypted values
// to the client.

function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set.");
  // Domain-separated from Auth.js's own use of the secret.
  return createHash("sha256").update(`secret-encryption:${secret}`).digest();
}

/** Encrypt to a compact `iv.tag.ciphertext` base64url string. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64url")).join(".");
}

/** Inverse of encryptSecret. Throws on tampering or a changed AUTH_SECRET. */
export function decryptSecret(stored: string): string {
  const [iv, tag, enc] = stored.split(".").map((p) => Buffer.from(p, "base64url"));
  if (!iv || !tag || !enc) throw new Error("Malformed encrypted secret.");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
