"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = require("../lib/prisma");
async function clearTemplates() {
    try {
        // Delete all templates
        const result = await prisma_1.prisma.documentTemplate.deleteMany({});
        console.log(`Deleted ${result.count} templates`);
    }
    catch (err) {
        console.error("Error clearing templates:", err);
    }
    finally {
        await prisma_1.prisma.$disconnect();
    }
}
clearTemplates();
