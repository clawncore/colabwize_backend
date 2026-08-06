"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const prisma_1 = require("../../lib/prisma");
const adminAuthService_1 = require("../../services/admin/adminAuthService");
const platformAdmin_1 = require("../../middleware/platformAdmin");
const auditLogService_1 = require("../../services/admin/auditLogService");
const rateLimiter_1 = require("../../middleware/rateLimiter");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const router = express_1.default.Router();
// Helper to track failed attempts and raise SecurityEvent if threshold crossed
async function recordFailedAttempt(email, ipAddress, userAgent) {
    try {
        const windowStart = new Date(Date.now() - 15 * 60 * 1000);
        const recentFailures = await prisma_1.prisma.auditLog.count({
            where: {
                action: 'ADMIN_LOGIN_FAILED',
                adminEmail: email.toLowerCase().trim(),
                createdAt: { gte: windowStart },
            },
        });
        if (recentFailures >= 3) {
            await prisma_1.prisma.securityEvent.create({
                data: {
                    type: 'brute_force_attempt',
                    severity: 'critical',
                    description: `Multiple failed admin login attempts (${recentFailures + 1}) detected for ${email}`,
                    ipAddress,
                    userAgent,
                    metadata: { email, count: recentFailures + 1 },
                },
            });
        }
    }
    catch (err) {
        logger_1.default.error('Failed to record security event:', err);
    }
}
// ==========================================
// 1. ADMIN LOGIN (Step 1 - Password Check)
// ==========================================
router.post('/login', rateLimiter_1.adminAuthRateLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password are required' });
        }
        const auditCtx = (0, auditLogService_1.extractAuditContext)(req);
        const validated = await adminAuthService_1.AdminAuthService.validateCredentials(email, password);
        if (!validated) {
            await (0, auditLogService_1.createAuditLog)({
                action: 'ADMIN_LOGIN_FAILED',
                adminEmail: email,
                metadata: { reason: 'Invalid credentials' },
                ...auditCtx,
            });
            await recordFailedAttempt(email, auditCtx.ipAddress, auditCtx.userAgent);
            return res.status(401).json({ success: false, error: 'Invalid admin credentials' });
        }
        const { adminUser, requiresMfa } = validated;
        if (requiresMfa) {
            return res.json({
                success: true,
                requiresMfa: true,
                email: adminUser.email,
                message: 'MFA verification required. Please enter your 6-digit TOTP code.',
            });
        }
        // Direct login if MFA disabled (explicit opt-out on the admin record)
        const result = await adminAuthService_1.AdminAuthService.verifyMfaAndLogin(adminUser.email, undefined, auditCtx.ipAddress, auditCtx.userAgent);
        if (!result) {
            return res.status(400).json({ success: false, error: 'Failed to issue admin session' });
        }
        await (0, auditLogService_1.createAuditLog)({
            action: 'ADMIN_LOGIN_SUCCESS',
            adminEmail: adminUser.email,
            ...auditCtx,
        });
        res.json({
            success: true,
            requiresMfa: false,
            token: result.token,
            admin: result.admin,
        });
    }
    catch (err) {
        logger_1.default.error('Admin login error:', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});
// ==========================================
// 2. VERIFY MFA (Step 2 - TOTP Code)
// ==========================================
router.post('/verify-mfa', rateLimiter_1.adminAuthRateLimiter, async (req, res) => {
    try {
        const { email, mfaCode } = req.body;
        if (!email || !mfaCode) {
            return res.status(400).json({ success: false, error: 'Email and MFA code are required' });
        }
        const auditCtx = (0, auditLogService_1.extractAuditContext)(req);
        const result = await adminAuthService_1.AdminAuthService.verifyMfaAndLogin(email, mfaCode, auditCtx.ipAddress, auditCtx.userAgent);
        if (!result) {
            await (0, auditLogService_1.createAuditLog)({
                action: 'ADMIN_MFA_FAILED',
                adminEmail: email,
                metadata: { reason: 'Invalid TOTP code' },
                ...auditCtx,
            });
            await recordFailedAttempt(email, auditCtx.ipAddress, auditCtx.userAgent);
            return res.status(401).json({ success: false, error: 'Invalid MFA verification code' });
        }
        await (0, auditLogService_1.createAuditLog)({
            action: 'ADMIN_MFA_SUCCESS',
            adminEmail: email,
            ...auditCtx,
        });
        // Send login alert notification email (Fire and forget)
        logger_1.default.info(`[ADMIN LOGIN ALERT] Admin ${email} authenticated successfully from IP: ${auditCtx.ipAddress || 'unknown'}`);
        res.json({
            success: true,
            token: result.token,
            admin: result.admin,
        });
    }
    catch (err) {
        logger_1.default.error('Admin MFA verify error:', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});
// ==========================================
// 3. GET CURRENT ADMIN PROFILE
// ==========================================
router.get('/me', async (req, res) => {
    try {
        // Accepts either a dedicated Admin JWT or a Supabase token whose email
        // matches an `admin_users` row (both resolved by resolveAdminRole).
        const role = await (0, platformAdmin_1.resolveAdminRole)(req);
        if (!role) {
            return res.status(403).json({ success: false, error: 'Not an administrator' });
        }
        const resolved = req.adminUser;
        let admin = null;
        try {
            admin = await prisma_1.prisma.adminUser.findUnique({
                where: { email: resolved.email },
                select: {
                    id: true,
                    email: true,
                    full_name: true,
                    role: true,
                    permissions: true,
                    mfa_enabled: true,
                    last_login: true,
                    created_at: true,
                },
            });
        }
        catch (err) {
            logger_1.default.warn(`AdminUser profile lookup failed (using resolved identity): ${err instanceof Error ? err.message : err}`);
        }
        if (!admin) {
            // The role was already resolved (either from an `admin_users` row or the
            // @colabwize.com domain fallback), so echo back the resolved identity.
            return res.json({
                success: true,
                admin: {
                    id: resolved.userId || null,
                    email: resolved.email,
                    full_name: resolved.email.split("@")[0] || null,
                    role: resolved.role,
                    permissions: resolved.permissions || [],
                    mfa_enabled: false,
                    last_login: null,
                    created_at: null,
                },
            });
        }
        res.json({ success: true, admin });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});
// ==========================================
// 4. SETUP INITIAL SUPER ADMIN (SEEDING)
// ==========================================
router.post('/setup-initial', async (req, res) => {
    try {
        const { email, password, fullName, secretKey } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password are required' });
        }
        if (password.length < 12) {
            return res.status(400).json({ success: false, error: 'Password must be at least 12 characters' });
        }
        // No hardcoded fallback: refuse to run unless explicitly configured.
        const setupKey = process.env.ADMIN_SETUP_KEY;
        if (!setupKey) {
            return res.status(503).json({
                success: false,
                error: 'Admin bootstrap is not configured. Set ADMIN_SETUP_KEY.',
            });
        }
        if (secretKey !== setupKey) {
            return res.status(403).json({ success: false, error: 'Invalid setup secret key' });
        }
        const existingCount = await prisma_1.prisma.adminUser.count();
        if (existingCount > 0) {
            return res.status(400).json({ success: false, error: 'Initial admin setup already completed' });
        }
        const password_hash = await bcrypt_1.default.hash(password, 12);
        const mfa_secret = adminAuthService_1.AdminAuthService.generateTotpSecret();
        const backup_codes = adminAuthService_1.AdminAuthService.generateBackupCodes();
        const superAdmin = await prisma_1.prisma.adminUser.create({
            data: {
                email: email.toLowerCase().trim(),
                password_hash,
                full_name: fullName || 'Super Admin',
                role: 'super_admin',
                permissions: ['*'],
                mfa_enabled: true,
                mfa_secret,
                backup_codes,
            },
        });
        await (0, auditLogService_1.createAuditLog)({
            action: 'ADMIN_SETUP_INITIAL',
            adminEmail: superAdmin.email,
            metadata: { adminId: superAdmin.id },
            ...(0, auditLogService_1.extractAuditContext)(req),
        });
        res.json({
            success: true,
            message: 'Super Admin successfully created',
            admin: {
                id: superAdmin.id,
                email: superAdmin.email,
                role: superAdmin.role,
            },
            // Returned exactly once so the operator can enroll their authenticator.
            mfa: {
                secret: mfa_secret,
                backupCodes: backup_codes,
            },
        });
    }
    catch (err) {
        logger_1.default.error('Initial admin setup error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.default = router;
