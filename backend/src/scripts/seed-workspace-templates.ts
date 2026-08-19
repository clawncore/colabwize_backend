import { prisma } from "../lib/prisma";

async function seed() {
    try {
        const initialTemplates = [
            {
                name: "Software Project",
                description: "A pre-configured workspace for software development with bugs, features, and priority tracking.",
                icon: "💻",
                labels: [
                    { name: "Bug", color: "#ef4444" },
                    { name: "Feature", color: "#3b82f6" },
                    { name: "Enhancement", color: "#10b981" },
                    { name: "Urgent", color: "#f59e0b" }
                ],
                custom_fields: [
                    { name: "Priority", type: "dropdown", options: ["High", "Medium", "Low"] },
                    { name: "Environment", type: "dropdown", options: ["Production", "Staging", "Development"] }
                ],
                tasks: [
                    { title: "Project Setup", description: "Initialize repository and basic structure", status: "todo" },
                    { title: "Define Requirements", description: "Gather stakeholder requirements", status: "todo" }
                ]
            },
            {
                name: "Research Paper",
                description: "Standard structure for academic research with citations, reviewers, and deadline tracking.",
                icon: "🎓",
                labels: [
                    { name: "Draft", color: "#94a3b8" },
                    { name: "Reviewing", color: "#f59e0b" },
                    { name: "Approved", color: "#10b981" },
                    { name: "Needs Revision", color: "#ef4444" }
                ],
                custom_fields: [
                    { name: "Journal/Conference", type: "text" },
                    { name: "Impact Factor", type: "number" }
                ],
                tasks: [
                    { title: "Literature Review", description: "Read and summarize relevant papers", status: "todo" },
                    { title: "Methodology Design", description: "Design the research methodology", status: "todo" }
                ]
            },
            {
                name: "Marketing Campaign",
                description: "Plan and track marketing activities, channels, and conversion goals.",
                icon: "📢",
                labels: [
                    { name: "Social Media", color: "#3b82f6" },
                    { name: "Email", color: "#ef4444" },
                    { name: "Ads", color: "#10b981" },
                    { name: "SEO", color: "#f59e0b" }
                ],
                custom_fields: [
                    { name: "Budget", type: "number" },
                    { name: "Channel", type: "dropdown", options: ["Google", "Facebook", "LinkedIn", "Instagram"] }
                ],
                tasks: [
                    { title: "Define Target Audience", description: "Research and define demographics", status: "todo" },
                    { title: "Content Creation", description: "Prepare visual and text assets", status: "todo" }
                ]
            }
        ];

        console.log("Seeding workspace templates...");

        for (const template of initialTemplates) {
            const existing = await prisma.workspaceTemplate.findFirst({
                where: { name: template.name }
            });

            if (existing) {
                await prisma.workspaceTemplate.update({
                    where: { id: existing.id },
                    data: template as any
                });
                console.log(`Updated template: ${template.name}`);
            } else {
                await prisma.workspaceTemplate.create({
                    data: template as any
                });
                console.log(`Created template: ${template.name}`);
            }
        }

        console.log("Seeding completed successfully.");
    } catch (error) {
        console.error("Error seeding templates:", error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

seed();
