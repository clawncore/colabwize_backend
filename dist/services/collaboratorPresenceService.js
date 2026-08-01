"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CollaboratorPresenceService = void 0;
const prisma_1 = require("../lib/prisma");
class CollaboratorPresenceService {
    /**
     * Cleans up stale collaborator presence records older than the specified minutes.
     * @param minutes - The age threshold in minutes to consider a record stale.
     * @returns The number of deleted records.
     */
    static async cleanupStalePresence(minutes) {
        const threshold = new Date(Date.now() - minutes * 60 * 1000);
        const result = await prisma_1.prisma.collaboratorPresence.deleteMany({
            where: {
                last_active_at: {
                    lt: threshold,
                },
            },
        });
        return result.count;
    }
}
exports.CollaboratorPresenceService = CollaboratorPresenceService;
