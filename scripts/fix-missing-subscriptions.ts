
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    console.log("Starting subscription backfill...");

    const usersWithoutSub = await prisma.user.findMany({
        where: {
            subscription: {
                is: null,
            },
        },
    });

    console.log(`Found ${usersWithoutSub.length} users without subscription.`);

    for (const user of usersWithoutSub) {
        try {
            await prisma.subscription.create({
                data: {
                    user_id: user.id,
                    plan: "free",
                    status: "active",
                },
            });
            console.log(`Created subscription for user ${user.id} (${user.email})`);
        } catch (error) {
            console.error(`Failed to create subscription for user ${user.id}:`, error);
        }
    }

    console.log("Backfill completed.");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
