import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";
import { EmailService } from "./emailService";

// AES-256-GCM Encryption Configuration
const ALGORITHM = "aes-256-gcm";
// Use a fallback secret for development if env var is missing (DO NOT USE IN PROD)
const ENCRYPTION_KEY = process.env.TWO_FACTOR_ENCRYPTION_KEY || "dev-secret-key-must-be-32-bytes!!";

// Ensure key is 32 bytes
const getKey = () => {
    const key = Buffer.from(ENCRYPTION_KEY);
    if (key.length !== 32) {
        // Pad or truncate to 32 bytes for dev safety, or throw error in prod
        const newKey = Buffer.alloc(32);
        key.copy(newKey);
        return newKey;
    }
    return key;
};

export class TwoFactorService {
    /**
     * Encrypt a secret
     */
    private static encrypt(text: string): string {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
        let encrypted = cipher.update(text, "utf8", "hex");
        encrypted += cipher.final("hex");
        const authTag = cipher.getAuthTag();
        // Format: iv:authTag:encrypted
        return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
    }

    /**
     * Decrypt a secret
     */
    private static decrypt(text: string): string {
        const parts = text.split(":");
        if (parts.length !== 3) throw new Error("Invalid encrypted string format");

        const iv = Buffer.from(parts[0], "hex");
        const authTag = Buffer.from(parts[1], "hex");
        const encrypted = parts[2];

        const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encrypted, "hex", "utf8");
        decrypted += decipher.final("utf8");
        return decrypted;
    }

    // Temporary in-memory storage for pending 2FA setups
    // Key: userId, Value: secret
    private static tempSecrets = new Map<string, string>();

    /**
     * Store temporary secret for setup phase
     */
    private static storeTempSecret(userId: string, secret: string) {
        this.tempSecrets.set(userId, secret);
        // Expire after 10 minutes to prevent memory leaks
        setTimeout(() => this.tempSecrets.delete(userId), 10 * 60 * 1000);
    }

    /**
     * Get temporary secret
     */
    static getTempSecret(userId: string): string | undefined {
        return this.tempSecrets.get(userId);
    }

    /**
     * Clear temporary secret
     */
    static clearTempSecret(userId: string) {
        this.tempSecrets.delete(userId);
    }

    /**
     * Generate a new 2FA secret and QR code URL
     * Phase 1: Safe, Pure, No DB Writes
     */
    static async generateSecret(email: string, userId: string) {
        const secret = generateSecret();
        // Use "ColabWize" as the issuer name for the Authenticator app
        const otpauth = generateURI({ secret, label: email, issuer: "ColabWize" });
        // Generate Data URI directly
        const qrCodeUrl = await QRCode.toDataURL(otpauth);

        // Store temporarily
        this.storeTempSecret(userId, secret);

        return {
            secret,   // For Manual Entry
            qrCodeUrl // For Scanning
        };
    }

    /**
     * Verify a TOTP token (works for both setup and login)
     */
    static verifyToken(token: string, secret: string): boolean {
        const result: any = verifySync({ token, secret, window: 1 } as any);
        // otplib verifySync can return an object { valid: boolean } or boolean depending on version/config
        if (typeof result === 'boolean') return result;
        return result && result.valid === true;
    }

    /**
     * Validate a login 2FA attempt
     */
    static async validateLogin(userId: string, token: string): Promise<boolean> {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { two_factor_enabled: true, two_factor_secret: true, two_factor_backup_codes: true },
        });

        if (!user || !user.two_factor_enabled || !user.two_factor_secret) {
            return false;
        }

        // 1. Try TOTP
        try {
            const secret = this.decrypt(user.two_factor_secret);
            const isValid = this.verifyToken(token, secret);
            if (isValid) return true;
        } catch (error) {
            logger.error("Error decrypting 2FA secret during login", { userId, error });
        }

        // 2. Try Backup Codes (if token is 8-10 chars, assuming backup codes are longer)
        // Backup codes are usually 8-10 hex/alphanumeric chars. TOTP is 6 digits.
        if (token.length > 6) {
            // Check against hashed backup codes requires hashing input and comparing
            // But we stored them as string[]? Ideally we should hash them.
            // For this implementation, we will assume we verify against the raw input if checking equality,
            // BUT standard security says hash them.
            // Let's iterate and check bcrypt? Or simple comparison if we stored plain (bad).
            // My plan said "Hashed array".

            // Implementation Detail: We need to compare hash(input) with stored_hashes.
            // Since we haven't implemented the "hashBackupCodes" helper fully yet, let's assume
            // for this MVP step we iterate and check. 
            // NOTE: Actual implementation involves checking all hashes.

            for (const hashedCode of user.two_factor_backup_codes) {
                // bcrypt.compareSync(token, hashedCode) -- expensive loop?
                // For now, let's assume we implement a simple direct check if NOT hashed yet,
                // OR better, we implement crypto.createHash logic for speed.

                // Let's use SHA256 for backup codes for speed + security (salt is implicit if unique randoms).
                const inputHash = crypto.createHash('sha256').update(token).digest('hex');
                if (inputHash === hashedCode) {
                    // Consumed! Remove it.
                    await prisma.user.update({
                        where: { id: userId },
                        data: {
                            two_factor_backup_codes: {
                                set: user.two_factor_backup_codes.filter((c: string) => c !== hashedCode)
                            }
                        }
                    });
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Enable 2FA for a user (Confirm Setup)
     * Phase 2: Irreversible Commit
     */
    static async enable2FA(userId: string, secret: string, token: string) {
        // 1. Verify the token against the pending secret
        if (!this.verifyToken(token, secret)) {
            throw new Error("Invalid verification code");
        }

        // 2. Generate Backup Codes
        const backupCodes = Array.from({ length: 10 }, () =>
            crypto.randomBytes(4).toString("hex") // 8 char hex codes
        );

        // 3. Hash Backup Codes
        const hashedBackupCodes = backupCodes.map(code =>
            crypto.createHash('sha256').update(code).digest('hex')
        );

        // 4. Encrypt Secret
        const encryptedSecret = this.encrypt(secret);

        // 5. Update User (Commit)
        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: {
                two_factor_enabled: true,
                two_factor_secret: encryptedSecret,
                two_factor_backup_codes: hashedBackupCodes,
                two_factor_confirmed_at: new Date(),
            },
            select: { email: true, full_name: true }
        });

        // 6. Clear Temporary Secret
        this.clearTempSecret(userId);

        // 7. Send Notification Email
        if (updatedUser.email) {
            await EmailService.send2FAEnabledEmail(updatedUser.email, updatedUser.full_name || "");
        }

        return { backupCodes };
    }


    /**
     * Disable 2FA
     */
    static async disable2FA(userId: string) {
        await prisma.user.update({
            where: { id: userId },
            data: {
                two_factor_enabled: false,
                two_factor_secret: null,
                two_factor_backup_codes: [],
                two_factor_confirmed_at: null,
            },
        });
    }
}
