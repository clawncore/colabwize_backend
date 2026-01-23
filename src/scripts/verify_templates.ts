import { prisma } from "../lib/prisma";
import fs from "fs";

async function verifyTemplates() {
    try {
        const templates = await prisma.documentTemplate.findMany({
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
        templates.forEach((t: any) => {
            output += `Template: ${t.name} (${t.type})\n`;
            output += `Content type: ${Array.isArray(t.content) ? "Array" : typeof t.content}\n`;
            if (Array.isArray(t.content)) {
                output += `Content length: ${t.content.length}\n`;
                output += `First node: ${JSON.stringify(t.content[0])}\n`;
            } else {
                output += `Content: ${JSON.stringify(t.content).substring(0, 100)}...\n`;
            }
            output += "---\n";
        });

        fs.writeFileSync("templates_check.txt", output);
        console.log("Check complete.");
    } catch (err) {
        console.error(err);
        fs.writeFileSync("templates_check.txt", "Error: " + err);
    }
}

verifyTemplates();
