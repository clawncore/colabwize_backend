import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

/**
 * AES-256-GCM encryption for OAuth tokens at rest.
 *
 * Format of the stored string: iv:authTag:ciphertext (all base64-encoded, colon-separated)
 *
 * The encryption key is derived from TOKEN_ENCRYPTION_KEY env var via scrypt.
 * Falls back to a derived key from DATABASE_URL in development only.
 */
export class TokenCrypto {
  private static readonly ALGORITHM = "aes-256-gcm";
  private static readonly KEY_LENGTH = 32;
  private static readonly IV_LENGTH = 16;
  private static readonly AUTH_TAG_LENGTH = 16;
  private static readonly SALT = Buffer.from("colabwize-oauth-token-salt-v1");

  private static getKey(): Buffer {
    const secret =
      process.env.TOKEN_ENCRYPTION_KEY ||
      (process.env.DATABASE_URL
        ? scryptSync(process.env.DATABASE_URL, this.SALT, this.KEY_LENGTH).toString("hex").slice(0, 32)
        : null);

    if (!secret) {
      throw new Error(
        "TOKEN_ENCRYPTION_KEY environment variable is required for token encryption. " +
          "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      );
    }

    return scryptSync(secret, this.SALT, this.KEY_LENGTH);
  }

  /**
   * Encrypt a plaintext string. Returns iv:authTag:ciphertext (base64 components).
   */
  static encrypt(plaintext: string): string {
    const key = this.getKey();
    const iv = randomBytes(this.IV_LENGTH);
    const cipher = createCipheriv(this.ALGORITHM, key, iv);

    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
      iv.toString("base64"),
      authTag.toString("base64"),
      encrypted.toString("base64"),
    ].join(":");
  }

  /**
   * Decrypt a ciphertext string produced by encrypt().
   * Throws if the token is malformed or tampered with.
   */
  static decrypt(ciphertext: string): string {
    const key = this.getKey();
    const parts = ciphertext.split(":");

    if (parts.length !== 3) {
      throw new Error(
        "Invalid encrypted token format. Expected iv:authTag:ciphertext with base64-encoded components.",
      );
    }

    const iv = Buffer.from(parts[0], "base64");
    const authTag = Buffer.from(parts[1], "base64");
    const encrypted = Buffer.from(parts[2], "base64");

    if (iv.length !== this.IV_LENGTH) {
      throw new Error(`Invalid IV length: expected ${this.IV_LENGTH}, got ${iv.length}`);
    }
    if (authTag.length !== this.AUTH_TAG_LENGTH) {
      throw new Error(`Invalid auth tag length: expected ${this.AUTH_TAG_LENGTH}, got ${authTag.length}`);
    }

    const decipher = createDecipheriv(this.ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  }

  /**
   * Check whether a string looks like it has been encrypted by this class.
   * Encrypted tokens contain exactly two colon separators and are base64-encoded.
   * Plaintext tokens (from before migration) will not match this pattern.
   */
  static isEncrypted(value: string): boolean {
    const parts = value.split(":");
    if (parts.length !== 3) return false;
    try {
      // Verify each part is valid base64 and has expected lengths
      const iv = Buffer.from(parts[0], "base64");
      const authTag = Buffer.from(parts[1], "base64");
      return (
        iv.length === this.IV_LENGTH &&
        authTag.length === this.AUTH_TAG_LENGTH &&
        parts[2].length > 0
      );
    } catch {
      return false;
    }
  }

  /**
   * Attempt to decrypt a token. If it's not encrypted (plaintext legacy token),
   * return it as-is. Handles the migration period where some tokens may be
   * plaintext and some encrypted.
   */
  static decryptOrPlaintext(value: string): string {
    if (this.isEncrypted(value)) {
      return this.decrypt(value);
    }
    return value;
  }
}
