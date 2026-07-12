import { prisma } from "./src/lib/prisma";
import { AuthorshipCertificateGenerator } from "./src/services/authorshipCertificateGenerator";

async function run() {
    try {
        const userId = "209e6c58-c4bd-4d08-8ccf-235d9ced2508";
        const project = await prisma.project.findFirst({
            where: { user_id: userId }
        });
        if (!project) {
            console.log("No project found for user", userId);
            return;
        }
        
        console.log("Starting certificate generation test for project:", project.id);
        const buffer = await AuthorshipCertificateGenerator.generateCertificate({
            projectId: project.id,
            userId: userId,
            userName: "Test User",
            projectTitle: project.title,
        });
        console.log("Success! Buffer size:", buffer.length);
    } catch (error) {
        console.error("Test failed with error:", error);
    }
}

run();
