"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminAuthService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const prisma_1 = require("../../lib/prisma");
const logger_1 = __importDefault(require("../../monitoring/logger"));
// No hardcoded fallback secret. Prefer ADMIN_JWT_SECRET, then JWT_SECRET.
// If neither is configured, generate a strong per-process secret so the server
// still boots for development, but log a CRITICAL warning. Production MUST set
// ADMIN_JWT_SECRET; otherwise admin sessions will not survive a restart.
const configuredSecret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || '';
const ADMIN_JWT_SECRET = configuredSecret || crypto_1.default.randomBytes(64).toString('hex');
if (!configuredSecret) {
    logger_1.default.error('CRITICAL: ADMIN_JWT_SECRET is not set. Using a random per-process secret. ' +
        'Admin sessions will not survive restarts. Set ADMIN_JWT_SECRET in production.');
}
const ADMIN_JWT_EXPIRES_IN = '2h';
// Simple TOTP validator using Node crypto (HMAC SHA1).
// No development bypass codes. MFA must be a valid TOTP or a valid backup code.
function verifyTotpCode(secret, token) {
    if (!secret || !token)
        return false;
    const cleanToken = token.trim();
    if (!/^\d{6}$/.test(cleanToken))
        return false;
    try {
        const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        let bits = '';
        for (let i = 0; i < secret.length; i++) {
            const val = base32chars.indexOf(secret.charAt(i).toUpperCase());
            if (val >= 0)
                bits += val.toString(2).padStart(5, '0');
        }
        const bytes = new Uint8Array(Math.floor(bits.length / 8));
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = parseInt(bits.substr(i * 8, 8), 2);
        }
        const epoch = Math.floor(Date.now() / 1000);
        const timeSteps = [Math.floor(epoch / 30), Math.floor(epoch / 30) - 1, Math.floor(epoch / 30) + 1];
        for (const timeStep of timeSteps) {
            const buffer = Buffer.alloc(8);
            buffer.writeBigInt64BE(BigInt(timeStep));
            const hmac = crypto_1.default.createHmac('sha1', Buffer.from(bytes));
            hmac.update(buffer);
            const digest = hmac.digest();
            const offset = digest[digest.length - 1] & 0xf;
            const code = ((digest[offset] & 0x7f) << 24) |
                ((digest[offset + 1] & 0xff) << 16) |
                ((digest[offset + 2] & 0xff) << 8) |
                (digest[offset + 3] & 0xff);
            const otp = (code % 1000000).toString().padStart(6, '0');
            if (otp === cleanToken)
                return true;
        }
    }
    catch (e) {
        logger_1.default.error('TOTP verification error:', e);
    }
    return false;
}
class AdminAuthService {
    /**
     * Generates a separate Admin JWT
     */
    static generateToken(payload) {
        return jsonwebtoken_1.default.sign(payload, ADMIN_JWT_SECRET, { expiresIn: ADMIN_JWT_EXPIRES_IN });
    }
    /**
     * Verifies an Admin JWT
     */
    static verifyToken(token) {
        try {
            const decoded = jsonwebtoken_1.default.verify(token, ADMIN_JWT_SECRET);
            if (decoded && decoded.type === 'admin') {
                return decoded;
            }
        }
        catch (err) {
            // Invalid or expired token
        }
        return null;
    }
    /**
     * Generates a new base32 TOTP secret (160 bits).
     */
    static generateTotpSecret() {
        const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        const bytes = crypto_1.default.randomBytes(20);
        let secret = '';
        let bits = 0;
        let value = 0;
        for (const byte of bytes) {
            value = (value << 8) | byte;
            bits += 8;
            while (bits >= 5) {
                secret += base32chars[(value >>> (bits - 5)) & 31];
                bits -= 5;
            }
        }
        if (bits > 0) {
            secret += base32chars[(value << (5 - bits)) & 31];
        }
        return secret;
    }
    /**
     * Generates high-entropy backup codes (8-char alphanumeric).
     */
    static generateBackupCodes(count = 5) {
        const codes = [];
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        for (let i = 0; i < count; i++) {
            let code = '';
            const bytes = crypto_1.default.randomBytes(8);
            for (const byte of bytes) {
                code += alphabet[byte % alphabet.length];
            }
            codes.push(code);
        }
        return codes;
    }
    /**
     * Primary Step 1: Validate Admin Credentials
     */
    static async validateCredentials(email, password) {
        const admin = await prisma_1.prisma.adminUser.findUnique({
            where: { email: email.toLowerCase().trim() },
        });
        if (!admin)
            return null;
        const isValidPassword = await bcrypt_1.default.compare(password, admin.password_hash);
        if (!isValidPassword)
            return null;
        return {
            adminUser: admin,
            requiresMfa: admin.mfa_enabled,
        };
    }
    /**
     * Step 2: Validate MFA Code & Issue Full Token.
     * When MFA is disabled, issues the token directly (explicit opt-out).
     */
    static async verifyMfaAndLogin(email, mfaCode, ipAddress, userAgent) {
        const admin = await prisma_1.prisma.adminUser.findUnique({
            where: { email: email.toLowerCase().trim() },
        });
        if (!admin)
            return null;
        if (admin.mfa_enabled) {
            if (!mfaCode)
                return null;
            const backupCodes = admin.backup_codes || [];
            const isCodeValid = verifyTotpCode(admin.mfa_secret || '', mfaCode) ||
                backupCodes.includes(mfaCode);
            if (!isCodeValid)
                return null;
        }
        await prisma_1.prisma.adminUser.update({
            where: { id: admin.id },
            data: { last_login: new Date() },
        });
        const token = this.generateToken({
            adminId: admin.id,
            email: admin.email,
            role: admin.role,
            type: 'admin',
            mfaVerified: true,
        });
        return {
            token,
            admin: {
                id: admin.id,
                email: admin.email,
                full_name: admin.full_name,
                role: admin.role,
                mfa_enabled: admin.mfa_enabled,
            },
        };
    }
}
exports.AdminAuthService = AdminAuthService;
