import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import type { Destination } from "./types";

/**
 * Phase 5 — Encrypted token store (gap C1).
 *
 * OAuth tokens for cloud destinations must be encrypted at rest, not stored in
 * plaintext. This module provides the crypto primitive (`EncryptedTokenStore`)
 * and a `TokenVault` that persists per-(user, provider) tokens encrypted.
 *
 * Production wiring: a `PrismaTokenVault` would implement `TokenVault` against a
 * table whose column holds only the ciphertext; the key lives in KMS / env and
 * is never persisted. The in-memory vault here is for tests and as a reference
 * implementation of the encryption contract.
 */

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

export interface EncryptedTokenStore {
  encrypt(plaintext: string): string;
  decrypt(cipher: string): string;
}

/**
 * AES-256-GCM token encryption. The key is supplied (env in prod, injected in
 * tests); ciphertext is `{iv}.{authTag}.{ciphertext}` in base64.
 */
export class AesGcmTokenStore implements EncryptedTokenStore {
  private readonly key: Buffer;

  constructor(key?: string) {
    const raw = key ?? process.env.EXPORT_TOKEN_KEY;
    if (!raw) {
      throw new Error(
        "EXPORT_TOKEN_KEY is not set — refusing to construct a token store without an encryption key.",
      );
    }
    // Normalize to a 32-byte key (sha256) so operators can supply any secret.
    this.key = Buffer.from(raw, "utf8");
    if (this.key.length !== 32) {
      this.key = (require("crypto") as typeof import("crypto")).createHash("sha256").update(this.key).digest();
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
  }

  decrypt(payload: string): string {
    const [ivB64, tagB64, dataB64] = payload.split(".");
    if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed ciphertext");
    const decipher = createDecipheriv(
      ALGO,
      this.key,
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]);
    return dec.toString("utf8");
  }
}

export interface TokenVault {
  store(userId: string, provider: Destination, token: string): Promise<void>;
  retrieve(userId: string, provider: Destination): Promise<string | null>;
  revoke(userId: string, provider: Destination): Promise<void>;
}

/** In-memory `TokenVault` — encrypted at rest, keyed by (userId, provider). */
export class InMemoryTokenVault implements TokenVault {
  private readonly crypto: EncryptedTokenStore;
  private readonly vault = new Map<string, string>();

  constructor(crypto?: EncryptedTokenStore) {
    this.crypto = crypto ?? new AesGcmTokenStore();
  }

  private key(userId: string, provider: Destination): string {
    return `${userId}:${provider}`;
  }

  async store(userId: string, provider: Destination, token: string): Promise<void> {
    this.vault.set(this.key(userId, provider), this.crypto.encrypt(token));
  }

  async retrieve(userId: string, provider: Destination): Promise<string | null> {
    const cipher = this.vault.get(this.key(userId, provider));
    if (!cipher) return null;
    return this.crypto.decrypt(cipher);
  }

  async revoke(userId: string, provider: Destination): Promise<void> {
    this.vault.delete(this.key(userId, provider));
  }
}
