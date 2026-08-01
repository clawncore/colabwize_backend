"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.flushAllCache = flushAllCache;
const logger_1 = __importDefault(require("../../monitoring/logger"));
async function flushAllCache() {
    logger_1.default.info('Flushing all administrative and system cache...');
    return true;
}
