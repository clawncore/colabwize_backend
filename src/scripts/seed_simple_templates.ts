import { prisma } from "../lib/prisma";

async function seedSimpleTemplates() {
    try {
        const templates = [
            {
                name: "Research Paper",
                description: "Structure for a standard research paper.",
                type: "research-paper",
                tags: ["research", "paper", "academic"],
                is_mvp_enabled: true,
                is_public: true,
                content: [
                    {
                        type: "heading",
                        attrs: { level: 1 },
                        content: [{ type: "text", text: "Research Paper" }],
                    },
                    {
                        type: "heading",
                        attrs: { level: 2 },
                        content: [{ type: "text", text: "Introduction" }],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "Describe the background and purpose of the study.",
                            },
                        ],
                    },
                    {
                        type: "heading",
                        attrs: { level: 2 },
                        content: [{ type: "text", text: "Methods" }],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "Explain the research design and data collection procedures.",
                            },
                        ],
                    },
                    {
                        type: "heading",
                        attrs: { level: 2 },
                        content: [{ type: "text", text: "Results" }],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "Present the findings of the study.",
                            },
                        ],
                    },
                    {
                        type: "heading",
                        attrs: { level: 2 },
                        content: [{ type: "text", text: "Discussion" }],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "Interpret the results and discuss implications.",
                            },
                        ],
                    },
                    {
                        type: "heading",
                        attrs: { level: 2 },
                        content: [{ type: "text", text: "References" }],
                    },
                ],
            },
            {
                name: "Literature Review",
                description: "Analyze and synthesize existing research on a topic.",
                type: "literature-review",
                tags: ["research", "review", "academic"],
                is_mvp_enabled: true,
                is_public: true,
                content: [
                    {
                        type: "heading",
                        attrs: { level: 1 },
                        content: [{ type: "text", text: "Literature Review" }],
                    },
                    {
                        type: "heading",
                        attrs: { level: 2 },
                        content: [{ type: "text", text: "Introduction" }],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "Define the topic and the scope of the review.",
                            },
                        ],
                    },
                    {
                        type: "heading",
                        attrs: { level: 2 },
                        content: [{ type: "text", text: "Thematic Review" }],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "Discuss themes, trends, and gaps in the literature.",
                            },
                        ],
                    },
                    {
                        type: "heading",
                        attrs: { level: 2 },
                        content: [{ type: "text", text: "Conclusion" }],
                    },
                    {
                        type: "heading",
                        attrs: { level: 2 },
                        content: [{ type: "text", text: "References" }],
                    },
                ],
            },
            {
                name: "Research Proposal",
                description: "Outline your proposed research project and methodology.",
                type: "research-proposal",
                tags: ["research", "proposal", "academic"],
                is_mvp_enabled: true,
                is_public: true,
                content: [
                    {
                        type: "heading",
                        attrs: { level: 1 },
                        content: [{ type: "text", text: "Research Proposal" }],
                    },
                    {
                        type: "heading",
                        attrs: { level: 2 },
                        content: [{ type: "text", text: "Introduction & Problem Statement" }],
                    },
                    {
                        type: "heading",
                        attrs: { level: 2 },
                        content: [{ type: "text", text: "Objectives" }],
                    },
                    {
                        type: "heading",
                        attrs: { level: 2 },
                        content: [{ type: "text", text: "Methodology" }],
                    },
                    {
                        type: "heading",
                        attrs: { level: 2 },
                        content: [{ type: "text", text: "Significance" }],
                    },
                    {
                        type: "heading",
                        attrs: { level: 2 },
                        content: [{ type: "text", text: "Timeline" }],
                    },
                    {
                        type: "heading",
                        attrs: { level: 2 },
                        content: [{ type: "text", text: "References" }],
                    },
                ],
            },
            {
                name: "Thesis",
                description: "Full structure for a master's thesis or dissertation.",
                type: "thesis",
                tags: ["research", "thesis", "dissertation", "academic"],
                is_mvp_enabled: true,
                is_public: true,
                content: [
                    {
                        type: "heading",
                        attrs: { level: 1 },
                        content: [{ type: "text", text: "Thesis Title" }],
                    },
                    {
                        type: "heading",
                        attrs: { level: 2 },
                        content: [{ type: "text", text: "Abstract" }],
                    },
                    {
                        type: "heading",
                        attrs: { level: 2 },
                        content: [{ type: "text", text: "Chapter 1: Introduction" }],
                    },
                    {
                        type: "heading",
                        attrs: { level: 2 },
                        content: [{ type: "text", text: "Chapter 2: Literature Review" }],
                    },
                    {
                        type: "heading",
                        attrs: { level: 2 },
                        content: [{ type: "text", text: "Chapter 3: Methodology" }],
                    },
                    {
                        type: "heading",
                        attrs: { level: 2 },
                        content: [{ type: "text", text: "Chapter 4: Results" }],
                    },
                    {
                        type: "heading",
                        attrs: { level: 2 },
                        content: [{ type: "text", text: "Chapter 5: Discussion" }],
                    },
                    {
                        type: "heading",
                        attrs: { level: 2 },
                        content: [{ type: "text", text: "References" }],
                    },
                ],
            },
        ];

        for (const template of templates) {
            await prisma.documentTemplate.create({
                data: template,
            });
            console.log(`Created template: ${template.name}`);
        }

        console.log("Simple templates seeded successfully!");
    } catch (error) {
        console.error("Error seeding templates:", error);
    } finally {
        await prisma.$disconnect();
    }
}

seedSimpleTemplates();
