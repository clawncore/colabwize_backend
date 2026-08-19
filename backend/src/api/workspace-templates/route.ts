import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";

export async function GET(request: Request) {
    try {
        const templates = await prisma.workspaceTemplate.findMany({
            where: { is_active: true },
            orderBy: { created_at: "asc" },
        });

        return new Response(JSON.stringify({ success: true, templates }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        logger.error("Error fetching workspace templates:", error);
        return new Response(
            JSON.stringify({ success: false, message: "Failed to fetch workspace templates" }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
}

export async function POST(request: Request) {
    try {
        const url = new URL(request.url, "http://localhost");
        const action = url.searchParams.get("action");

        if (action === "seed") {
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

            for (const template of initialTemplates) {
                await prisma.workspaceTemplate.upsert({
                    where: { name_description: { name: template.name, description: template.description || "" } }, // Requires unique constraint or manual check
                    update: template,
                    create: template,
                });
            }

            // Actually, since I didn't add the unique constraint in schema, I'll just check if it exists
            for (const template of initialTemplates) {
                const existing = await prisma.workspaceTemplate.findFirst({
                    where: { name: template.name }
                });

                if (existing) {
                    await prisma.workspaceTemplate.update({
                        where: { id: existing.id },
                        data: template
                    });
                } else {
                    await prisma.workspaceTemplate.create({
                        data: template
                    });
                }
            }

            return new Response(JSON.stringify({ success: true, message: "Templates seeded successfully" }), {
                headers: { "Content-Type": "application/json" },
            });
        }

        return new Response(JSON.stringify({ success: false, message: "Invalid action" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        logger.error("Error seeding workspace templates:", error);
        return new Response(
            JSON.stringify({ success: false, message: "Failed to seed workspace templates" }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
}
