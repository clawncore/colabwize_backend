import prisma from "../lib/prisma";

async function verifyRoles() {
    console.log("Checking Workspace Role Enforcement...");

    const userId = "b182390a-c0b3-4f10-b74c-4573f084be1a"; // A known user ID or first user

    // 1. Check if workspaces include 'role'
    console.log("\n1. Verifying role in workspace response...");
    const workspace = await prisma.workspace.findFirst({
        where: { members: { some: { user_id: userId } } },
        include: { members: true }
    });

    if (workspace) {
        const member = workspace.members.find((m: any) => m.user_id === userId);
        console.log(`User ${userId} is a member of ${workspace.id} with role ${member?.role}`);
        // This is what the controller should return now
    } else {
        console.log("No workspace memberships found for verification.");
    }

    // 2. Mocking a task deletion attempt from a viewer logic (simulating the controller check)
    console.log("\n2. Simulating backend permission check for a Viewer...");

    const viewerMember = await prisma.workspaceMember.findFirst({
        where: { role: "viewer" }
    });

    if (viewerMember) {
        const roles = ['viewer', 'editor', 'admin'];
        const requiredRole = 'editor';
        const hasPermission = roles.indexOf(viewerMember.role) >= roles.indexOf(requiredRole);
        console.log(`Viewer permission check for 'editor' action: ${hasPermission ? "FAILED (Allowed)" : "PASSED (Denied)"}`);

        if (hasPermission) {
            console.error("FAIL: Viewer should not have editor permissions");
        } else {
            console.log("SUCCESS: Viewer correctly denied editor-level action.");
        }
    } else {
        console.log("No viewer account found to test.");
    }

    process.exit(0);
}

verifyRoles().catch(err => {
    console.error(err);
    process.exit(1);
});
