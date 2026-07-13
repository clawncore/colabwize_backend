import { prisma } from "../lib/prisma";

async function clearTemplates() {
    try {
        // Delete all templates
        const result = await prisma.documentTemplate.deleteMany({});
        console.log(`Deleted ${result.count} templates`);
    } catch (err) {
        console.error("Error clearing templates:", err);
    } finally {
        await prisma.$disconnect();
    }
}

clearTemplates();
