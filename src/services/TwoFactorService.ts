import { authenticator } from "otplib";
import QRCode from "qrcode";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";
import { EmailService } from "./emailService";

// Configure authenticator window for time tolerance (otplib v12)
authenticator.options = { ...authenticator.options, window: 1 };

// AES-256-GCM Encryption Configuration
const ALGORITHM = "aes-256-gcm";

// Deferred encryption key resolution — throws only when 2FA functions are
// actually used, not at module import time. This prevents the server from
// crashing on startup if the env var is missing (it's optional unless 2FA is enabled).
const getEncryptionKey = (): string => {
    const key = process.env.TWO_FACTOR_ENCRYPTION_KEY;
    if (!key) {
        throw new Error("TWO_FACTOR_ENCRYPTION_KEY must be set in environment variables");
    }
    return key;
};

// Accept either a 32-byte raw secret or a 64-character hexadecimal secret.
const getKey = () => {
    const raw = getEncryptionKey();
    const key = /^[0-9a-fA-F]{64}$/.test(raw)
        ? Buffer.from(raw, "hex")
        : Buffer.from(raw);
    if (key.length !== 32) {
        throw new Error(`TWO_FACTOR_ENCRYPTION_KEY must be exactly 32 bytes, got ${key.length}`);
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
        const secret = authenticator.generateSecret();
        // Use "ColabWize" as the issuer name for the Authenticator app
        const otpauth = authenticator.keyuri(email, "ColabWize", secret);
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
        return authenticator.verify({ token, secret });
    }

    /**
     * Validate a login 2FA attempt
     * @returns true if valid, false if invalid token, throws ErrorConfigurationError if 2FA is misconfigured
     */
    static async validateLogin(userId: string, token: string): Promise<boolean> {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { two_factor_enabled: true, two_factor_secret: true, two_factor_backup_codes: true },
        });

        if (!user || !user.two_factor_enabled || !user.two_factor_secret) {
            return false;
        }

        // Check if encryption key is configured before attempting decryption
        if (!process.env.TWO_FACTOR_ENCRYPTION_KEY) {
            throw new Error(
                "2FA service is not configured: TWO_FACTOR_ENCRYPTION_KEY is not set. " +
                "Contact support to complete 2FA verification."
            );
        }

        // 1. Try TOTP
        try {
            const secret = this.decrypt(user.two_factor_secret);
            const isValid = this.verifyToken(token, secret);
            if (isValid) return true;
        } catch (error) {
            logger.error("Error decrypting 2FA secret during login", { userId, error });
        }

        // 2. Try Backup Codes using constant-time comparison
        // Backup codes are hashed with SHA-256 for speed (unique random codes make per-code salt optional)
        if (token.length > 6) {
            const inputHash = crypto.createHash('sha256').update(token).digest('hex');
            for (const hashedCode of user.two_factor_backup_codes) {
                if (crypto.timingSafeEqual(Buffer.from(inputHash), Buffer.from(hashedCode))) {
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
     * @param userId The user ID
     * @param token The 2FA code to verify (Security requirement) - TOTP or Backup Code
     */
    static async disable2FA(userId: string, token: string) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                two_factor_secret: true,
                two_factor_backup_codes: true
            },
        });

        if (!user || !user.two_factor_secret) {
            throw new Error("2FA is not enabled or user not found");
        }

        let isVerified = false;

        // 1. Try TOTP Verification
        try {
            const secret = this.decrypt(user.two_factor_secret);
            if (this.verifyToken(token, secret)) {
                isVerified = true;
            }
        } catch (error) {
            logger.error("Error decrypting 2FA secret during disable", { userId, error });
        }

        // 2. Try Backup Codes (if not already verified)
        if (!isVerified && token.length > 6) {
            const inputHash = crypto.createHash('sha256').update(token).digest('hex');
            if (user.two_factor_backup_codes.includes(inputHash)) {
                isVerified = true;
            }
        }

        if (!isVerified) {
            throw new Error("Invalid verification code or backup code");
        }

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
