
import logger from "../monitoring/logger";
import { SupabaseStorageService } from "./supabaseStorageService";

export class ContentNormalizer {
    /**
     * Normalize content for export.
     * - Resolves image URLs (converts relative/storage paths to signed URLs)
     * - Validates and fixes table structures
     * - Ensures block structure is robust
     */
    static async normalizeContent(content: any): Promise<any> {
        if (!content || !content.content) {
            return content;
        }

        // Deep clone to avoid mutating original object in memory (though usually it's a fresh DB fetch)
        const clonedContent = JSON.parse(JSON.stringify(content));

        // Process nodes recursively
        await this.processNodes(clonedContent.content);

        return clonedContent;
    }

    private static async processNodes(nodes: any[]) {
        if (!nodes || !Array.isArray(nodes)) return;

        for (const node of nodes) {
            if (node.type === "image" || node.type === "imageExtension") {
                await this.normalizeImageNode(node);
            } else if (node.type === "table") {
                this.normalizeTableNode(node);
            }

            // Recursively process children
            if (node.content) {
                await this.processNodes(node.content);
            }
        }
    }

    private static async normalizeImageNode(node: any) {
        if (!node.attrs || !node.attrs.src) return;

        const src = node.attrs.src;

        // Check if it needs signing
        // 1. Is it a relative path? (often stored as "user_id/filename")
        // 2. Is it a full supabase storage URL but not signed? (harder to detect, but usually we focus on relative paths stored in DB)

        // We assume if it doesn't start with http/https/data, it might be a relative path in our bucket
        // OR if it contains our supabase project URL but no token? (Simplify: just handle relative paths first)

        // Logic: If it looks like a file path "user_id/timestamp_filename", sign it.
        // If it starts with "/", it's likely a relative URL to the app, which might proxy to storage? 
        // Actually, `SupabaseStorageService` uploads return `data.path` which is "userId/filename".
        // So the DB likely stores "userId/filename" OR a full URL.

        // Let's assume if it is NOT a data URL, and NOT a remote HTTP URL (unless it matches our bucket), we try to sign it.

        const isDataUrl = src.startsWith("data:");
        const isHttp = src.startsWith("http");

        if (!isDataUrl) {
            if (!isHttp) {
                // It's a relative path (e.g. "123/456_file.png")
                // Sign it!
                try {
                    // Remove leading slash if present
                    const cleanPath = src.startsWith("/") ? src.substring(1) : src;

                    // Generate signed URL valid for 1 hour (3600s)
                    const signedUrl = await SupabaseStorageService.createSignedUrl(cleanPath, 3600);

                    if (signedUrl) {
                        node.attrs.src = signedUrl;
                        // Add a flag so export service knows it's resolved
                        node.attrs.resolved = true;
                        logger.debug("Resolved signed URL for image", { original: src });
                    }
                } catch (error) {
                    logger.warn("Failed to sign image URL", { src, error });
                }
            }
        }
    }

    private static normalizeTableNode(node: any) {
        // Basic validation: ensure it has rows
        if (!node.content || !Array.isArray(node.content)) {
            // If table has no content, it's invalid. Stub it with one empty cell to prevent crash
            node.content = [{
                type: "tableRow",
                content: [{
                    type: "tableCell",
                    content: [{ type: "paragraph", content: [] }]
                }]
            }];
            return;
        }

        // 1. Find the maximum number of columns across all rows
        let maxCols = 0;
        node.content.forEach((row: any) => {
            if (row.type === "tableRow" && row.content && Array.isArray(row.content)) {
                maxCols = Math.max(maxCols, row.content.length);
            }
        });

        // Ensure at least 1 column
        maxCols = Math.max(maxCols, 1);

        // 2. Normalize every row
        node.content.forEach((row: any) => {
            if (row.type !== "tableRow") {
                row.type = "tableRow";
            }
            if (!row.content || !Array.isArray(row.content)) {
                row.content = [];
            }

            // Pad row with empty cells if it's shorter than maxCols
            while (row.content.length < maxCols) {
                row.content.push({
                    type: "tableCell",
                    content: [{ type: "paragraph", content: [] }]
                });
            }

            // Ensure every cell has a valid type and content
            row.content.forEach((cell: any) => {
                if (cell.type !== "tableHeader" && cell.type !== "tableCell") {
                    cell.type = "tableCell";
                }
                if (!cell.content || !Array.isArray(cell.content) || cell.content.length === 0) {
                    cell.content = [{ type: "paragraph", content: [] }];
                }
            });
        });

        // Save maxCols in attributes so export service can use it for width calculations
        if (!node.attrs) node.attrs = {};
        node.attrs.maxCols = maxCols;
    }
}
