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
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateContentHash = generateContentHash;
exports.generateCaseSensitiveContentHash = generateCaseSensitiveContentHash;
const crypto = __importStar(require("crypto"));
/**
 * Generates a SHA-256 hash for the given content
 * This is used to create a unique fingerprint for document content
 * to enable caching of plagiarism results for identical content
 *
 * @param content - The document content to hash
 * @returns A hexadecimal string representing the SHA-256 hash
 */
function generateContentHash(content) {
    // Normalize the content by trimming whitespace and converting to lowercase
    // This ensures that minor formatting differences don't create different hashes
    const normalizedContent = content.trim().toLowerCase();
    // Create SHA-256 hash
    const hash = crypto.createHash("sha256");
    hash.update(normalizedContent);
    return hash.digest("hex");
}
/**
 * Generates a hash for content while preserving case sensitivity
 * Useful when case matters for determining content uniqueness
 *
 * @param content - The document content to hash
 * @returns A hexadecimal string representing the SHA-256 hash
 */
function generateCaseSensitiveContentHash(content) {
    // Normalize the content by just trimming whitespace
    const normalizedContent = content.trim();
    // Create SHA-256 hash
    const hash = crypto.createHash("sha256");
    hash.update(normalizedContent);
    return hash.digest("hex");
}
