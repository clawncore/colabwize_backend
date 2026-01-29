import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";

export const CREDIT_COSTS = {
    // Deprecated static costs - moving to dynamic calculation
    scan: 1, // Base cost if metadata missing (fallback)
    originality: 1,
    citation: 1,
    certificate: 1,
    ai_chat: 1,
};

export class CreditService {
    /**
     * Calculate credit cost based on usage metadata
     * Rule: 1 Credit = 1000 words processed
     */
    static calculateCost(feature: string, metadata?: { wordCount?: number, inputWords?: number, outputWords?: number }): number {
        if (!metadata) {
            // Fallback for legacy calls without metadata
            return CREDIT_COSTS[feature as keyof typeof CREDIT_COSTS] || 1;
        }

        let words = 0;

        switch (feature) {
            case 'scan':
            case 'citation_audit':
                // Citation audits: 1 credit per 1000 words
                words = metadata.wordCount || 0;
                return Math.ceil(words / 1000);

            case 'rephrase':
                // Rephrase: (Input + Output) / 1000
                words = (metadata.inputWords || 0) + (metadata.outputWords || 0);
                return Math.ceil(words / 1000);

            case 'ai_chat':
                // AI Chat: (Input + Output) / 2000 (Cheaper)
                words = (metadata.inputWords || 0) + (metadata.outputWords || 0);
                return Math.ceil(words / 2000);

            case 'originality':
                // Originality: Higher cost (Future) - e.g. / 500
                words = metadata.wordCount || 0;
                return Math.ceil(words / 500);

            default:
                return 1; // Default safety cost
        }
    }

    /**
     * Get user's credit balance
     */
    static async getBalance(userId: string): Promise<number> {
        const balance = await prisma.creditBalance.findUnique({
            where: { user_id: userId },
        });
        return balance?.balance || 0;
    }

    /**
     * Add credits to user balance (Purchase, Bonus, etc.)
     */
    static async addCredits(
        userId: string,
        amount: number,
        type: "PURCHASE" | "BONUS" | "REFUND" | "USAGE",
        referenceId?: string,
        description?: string
    ) {
        return await prisma.$transaction(async (tx: any) => {
            // Fix 2: Credit Grant Locking (Order-Level Idempotency)
            if (referenceId && type === "PURCHASE") {
                const existingTransaction = await tx.creditTransaction.findFirst({
                    where: {
                        reference_id: referenceId,
                        type: "PURCHASE",
                    },
                });

                if (existingTransaction) {
                    logger.info("Credit grant skipped (Idempotent)", { userId, referenceId, type });
                    // Return current balance logic without modification
                    return await tx.creditBalance.findUnique({ where: { user_id: userId } });
                }
            }

            // Create transaction record
            const transaction = await tx.creditTransaction.create({
                data: {
                    user_id: userId,
                    amount,
                    type,
                    reference_id: referenceId,
                    description,
                },
            });

            // Update balance
            const balance = await tx.creditBalance.upsert({
                where: { user_id: userId },
                create: {
                    user_id: userId,
                    balance: amount,
                    lifetime_purchased: amount,
                    lifetime_used: 0,
                },
                update: {
                    balance: { increment: amount },
                    lifetime_purchased: { increment: amount },
                },
            });

            logger.info("Credits added", { userId, amount, type, newBalance: balance.balance });
            return balance;
        });
    }

    /**
     * Deduct credits for usage
     * Throws error if insufficient balance
     */
    static async deductCredits(
        userId: string,
        amount: number,
        referenceId?: string,
        description?: string
    ) {
        return await prisma.$transaction(async (tx: any) => {
            const currentBalance = await tx.creditBalance.findUnique({
                where: { user_id: userId },
            });

            if (!currentBalance || currentBalance.balance < amount) {
                throw new Error("Insufficient credit balance");
            }

            // Create transaction record
            await tx.creditTransaction.create({
                data: {
                    user_id: userId,
                    amount: -amount, // Negative for usage
                    type: "USAGE",
                    reference_id: referenceId,
                    description,
                },
            });

            // Update balance
            const balance = await tx.creditBalance.update({
                where: { user_id: userId },
                data: {
                    balance: { decrement: amount },
                    lifetime_used: { increment: amount },
                },
            });

            logger.info("Credits deducted", { userId, amount, newBalance: balance.balance });
            return balance;
        });
    }

    /**
     * Check if user has enough credits
     */
    static async hasEnoughCredits(userId: string, cost: number): Promise<boolean> {
        const balance = await this.getBalance(userId);
        return balance >= cost;
    }
}
