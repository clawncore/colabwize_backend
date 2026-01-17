import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";

export const CREDIT_COSTS = {
    scan: 100,
    originality: 150,
    citation: 50,
    certificate: 20,
};

export class CreditService {
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
        type: "PURCHASE" | "BONUS" | "REFUND",
        referenceId?: string,
        description?: string
    ) {
        return await prisma.$transaction(async (tx) => {
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
        return await prisma.$transaction(async (tx) => {
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
