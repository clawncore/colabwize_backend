"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = require("../lib/prisma");
const fs_1 = __importDefault(require("fs"));
async function verifyTemplates() {
    try {
        const templates = await prisma_1.prisma.documentTemplate.findMany({
            where: {
                type: {
                    in: ["research-paper", "literature-review", "research-proposal", "thesis"]
                }
            },
            select: {
                name: true,
                type: true,
                content: true
            }
        });
        let output = `Found templates: ${templates.length}\n`;
        templates.forEach((t) => {
            output += `Template: ${t.name} (${t.type})\n`;
            output += `Content type: ${Array.isArray(t.content) ? "Array" : typeof t.content}\n`;
            if (Array.isArray(t.content)) {
                output += `Content length: ${t.content.length}\n`;
                output += `First node: ${JSON.stringify(t.content[0])}\n`;
            }
            else {
                output += `Content: ${JSON.stringify(t.content).substring(0, 100)}...\n`;
            }
            output += "---\n";
        });
        fs_1.default.writeFileSync("templates_check.txt", output);
        console.log("Check complete.");
    }
    catch (err) {
        console.error(err);
        fs_1.default.writeFileSync("templates_check.txt", "Error: " + err);
    }
}
verifyTemplates();
