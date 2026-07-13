import { prisma } from "../lib/prisma";
import { Citation } from "@prisma/client";

interface GraphNode {
    id: string;
    name: string;
    type: "project" | "citation" | "author" | "concept";
    val: number; // Size
    color?: string;
}

interface GraphLink {
    source: string;
    target: string;
    type: "cites" | "authored_by" | "relates_to";
}

export class AnalysisGraphService {
    /**
     * Generate knowledge graph data for a specific project
     */
    static async getProjectGraph(projectId: string): Promise<{ nodes: GraphNode[]; links: GraphLink[] }> {
        // 1. Fetch Project & Citations
        const project = await prisma.project.findUnique({
            where: { id: projectId },
            include: {
                citations: true
            }
        });

        if (!project) {
            throw new Error("Project not found");
        }

        const nodes: GraphNode[] = [];
        const links: GraphLink[] = [];

        // 2. Create Central Project Node
        nodes.push({
            id: "PROJECT_ROOT",
            name: project.title || "Untitled Project",
            type: "project",
            val: 20, // Big central node
            color: "#ffffff"
        });

        // Track authors to avoid duplicates
        const authorMap = new Map<string, string>(); // Name -> ID

        // 3. Process Citations
        project.citations.forEach((citation: Citation) => {
            // Add Citation Node
            nodes.push({
                id: citation.id,
                name: citation.title.substring(0, 30) + (citation.title.length > 30 ? "..." : ""),
                type: "citation",
                val: 10,
                color: "#10b981" // Green (Verified/Good)
            });

            // Link Project -> Citation
            links.push({
                source: "PROJECT_ROOT",
                target: citation.id,
                type: "cites"
            });

            // Process Authors (Simple split by comma or 'and')
            // Note: This is rudimentary. In production, use structured author lists.
            const authors = citation.author ? citation.author.split(/,| and /) : ["Unknown"];

            authors.forEach(authName => {
                const cleanName = authName.trim();
                if (cleanName.length < 2) return;

                let authorId = authorMap.get(cleanName);

                // Use existing author node or create new one
                if (!authorId) {
                    authorId = `AUTH_${Math.random().toString(36).substr(2, 9)}`;
                    authorMap.set(cleanName, authorId);

                    nodes.push({
                        id: authorId,
                        name: cleanName,
                        type: "author",
                        val: 5, // Smaller
                        color: "#f59e0b" // Amber
                    });
                }

                // Link Citation -> Author
                links.push({
                    source: citation.id,
                    target: authorId!,
                    type: "authored_by"
                });
            });
        });

        return { nodes, links };
    }
}
