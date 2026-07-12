import { BillingGateway } from "./src/billing/BillingGateway";
import { prisma } from "./src/lib/prisma";

async function run() {
    const userId = "209e6c58-c4bd-4d08-8ccf-235d9ced2508";
    try {
        const ent = await prisma.userEntitlement.findUnique({ where: { user_id: userId } });
        console.log("Entitlement features:", ent?.features);
        
        console.log("Attempting to hold certificate limit...");
        const result = await BillingGateway.withFeature(userId, "certificate", undefined, async () => {
            console.log("Inside withFeature block! It succeeded.");
            return "success";
        });
        console.log("Result:", result);
    } catch (error: any) {
        console.error("Error from BillingGateway:", error.message, error.code, error.data);
    }
}

run();
