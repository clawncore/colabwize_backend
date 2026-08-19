import { prisma } from "../lib/prisma";

async function verify() {
    try {
        const user = await prisma.user.findFirst();
        if (!user) {
            console.error("No user found for testing");
            return;
        }

        const template = await prisma.workspaceTemplate.findFirst({
            where: { name: "Software Project" }
        });

        if (!template) {
            console.error("Template 'Software Project' not found");
            return;
        }

        console.log(`Using template: ${template.name} (${template.id})`);

        // Mock the POST /api/workspaces logic
        const workspace = await prisma.workspace.create({
            data: {
                name: "Test Software Workspace",
                description: "Testing structural template",
                icon: "🧪",
                owner_id: user.id,
                template_id: template.id,
                members: {
                    create: {
                        user_id: user.id,
                        role: "admin",
                    },
                },
            },
        });

        console.log(`Workspace created: ${workspace.id}`);

        // Apply template settings (logic from route.ts)
        // Labels
        if (template.labels && Array.isArray(template.labels)) {
            await prisma.workspaceLabel.createMany({
                data: (template.labels as any[]).map((lc: any) => ({
                    workspace_id: workspace.id,
                    name: lc.name,
                    color: lc.color || "#94a3b8"
                }))
            });
            console.log("Labels applied");
        }

        // Custom Fields
        if (template.custom_fields && Array.isArray(template.custom_fields)) {
            for (const field of template.custom_fields as any[]) {
                await prisma.workspaceCustomField.create({
                    data: {
                        workspace_id: workspace.id,
                        name: field.name,
                        type: field.type || "text",
                        options: field.options || null
                    }
                });
            }
            console.log("Custom fields applied");
        }

        // Tasks
        if (template.tasks && Array.isArray(template.tasks)) {
            await prisma.workspaceTask.createMany({
                data: (template.tasks as any[]).map((task: any) => ({
                    workspace_id: workspace.id,
                    creator_id: user.id,
                    title: task.title,
                    description: task.description || null,
                    status: task.status || "todo"
                }))
            });
            console.log("Tasks applied");
        }

        // Final check
        const labels = await prisma.workspaceLabel.findMany({ where: { workspace_id: workspace.id } });
        const fields = await prisma.workspaceCustomField.findMany({ where: { workspace_id: workspace.id } });
        const tasks = await prisma.workspaceTask.findMany({ where: { workspace_id: workspace.id } });

        console.log(`Verification:
    - Labels: ${labels.length} (Expected: 4)
    - Custom Fields: ${fields.length} (Expected: 2)
    - Tasks: ${tasks.length} (Expected: 2)
    `);

        if (labels.length === 4 && fields.length === 2 && tasks.length === 2) {
            console.log("VERIFICATION SUCCESSFUL");
        } else {
            console.error("VERIFICATION FAILED: Counts mismatch");
        }

        // Cleanup
        await prisma.workspace.delete({ where: { id: workspace.id } });
        console.log("Cleanup done.");

    } catch (error) {
        console.error("Verification error:", error);
    } finally {
        await prisma.$disconnect();
    }
}

verify();
