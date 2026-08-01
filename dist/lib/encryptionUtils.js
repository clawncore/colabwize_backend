"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encrypt = encrypt;
exports.decrypt = decrypt;
exports.hash = hash;
const crypto = __importStar(require("crypto"));
const logger_1 = __importDefault(require("../monitoring/logger"));
const secrets_service_1 = require("../services/secrets-service");
// Get encryption key from environment variables or generate a default one
// In production, this should be a securely generated and stored key
const DEFAULT_ENCRYPTION_KEY = "default-key-for-development-only-32bytes!";
const IV_LENGTH = 16; // For AES, this is always 16
/**
 * Gets the encryption key from secrets service
 * @returns Encryption key as string
 */
async function getEncryptionKey() {
    const key = await secrets_service_1.SecretsService.getTokenEncryptionKey();
    return key || DEFAULT_ENCRYPTION_KEY;
}
/**
 * Encrypts a string using AES-256-CBC encryption
 * @param text The text to encrypt
 * @returns Encrypted text as hex string
 */
async function encrypt(text) {
    try {
        const encryptionKey = await getEncryptionKey();
        // Ensure key is 32 bytes for AES-256
        let key = Buffer.from(encryptionKey, "utf8");
        if (key.length > 32) {
            key = key.slice(0, 32); // Truncate if too long
        }
        else if (key.length < 32) {
            // Pad with zeros if too short
            const paddedKey = Buffer.alloc(32);
            key.copy(paddedKey);
            key = paddedKey;
        }
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
        let encrypted = cipher.update(text, "utf8", "hex");
        encrypted += cipher.final("hex");
        // Prepend IV to encrypted data so we can use it for decryption
        const encryptedWithIv = iv.toString("hex") + ":" + encrypted;
        return encryptedWithIv;
    }
    catch (error) {
        logger_1.default.error("Error encrypting text", { error });
        throw new Error("Encryption failed");
    }
}
/**
 * Decrypts a string using AES-256-CBC encryption
 * @param encryptedText The encrypted text to decrypt
 * @returns Decrypted text
 */
async function decrypt(encryptedText) {
    try {
        const encryptionKey = await getEncryptionKey();
        // Ensure key is 32 bytes for AES-256
        let key = Buffer.from(encryptionKey, "utf8");
        if (key.length > 32) {
            key = key.slice(0, 32); // Truncate if too long
        }
        else if (key.length < 32) {
            // Pad with zeros if too short
            const paddedKey = Buffer.alloc(32);
            key.copy(paddedKey);
            key = paddedKey;
        }
        // Split IV and encrypted data
        const textParts = encryptedText.split(":");
        const iv = Buffer.from(textParts[0], "hex");
        const encrypted = textParts.slice(1).join(":"); // Join in case there were colons in the encrypted data
        const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
        let decrypted = decipher.update(encrypted, "hex", "utf8");
        decrypted += decipher.final("utf8");
        return decrypted;
    }
    catch (error) {
        logger_1.default.error("Error decrypting text", { error });
        throw new Error("Decryption failed");
    }
}
/**
 * Hashes a string using SHA-256
 * @param text The text to hash
 * @returns Hashed text as hex string
 */
function hash(text) {
    try {
        const hash = crypto.createHash("sha256");
        hash.update(text);
        return hash.digest("hex");
    }
    catch (error) {
        logger_1.default.error("Error hashing text", { error });
        throw new Error("Hashing failed");
    }
}
