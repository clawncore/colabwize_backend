import axios from "axios";
import { prisma } from "../lib/prisma.js";

export class MendeleyService {
    static async fetchLibrary(accessToken: string, limit: number = 50, start: number = 0) {
        try {
            const response = await axios.get("https://api.mendeley.com/documents", {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    Accept: "application/vnd.mendeley-document.1+json"
                },
                params: {
                    limit,
                    view: "all"
                }
            });
            return response.data;
        } catch (error: any) {
            console.error("Mendeley fetchLibrary config error:", error.response?.data || error.message);
            throw error;
        }
    }

    static async queryItems(accessToken: string, query: string) {
        try {
            const response = await axios.get("https://api.mendeley.com/search/catalog", {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    Accept: "application/vnd.mendeley-document.1+json"
                },
                params: {
                    title: query,
                    limit: 50,
                    view: "all"
                }
            });
            return response.data;
        } catch (error: any) {
            console.error("Mendeley queryItems Error:", error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Import a Mendeley item into the project's citation list
     */
    static async importItem(colabUserId: string, projectId: string, itemData: any) {
        try {
            const authors = itemData.authors?.map((a: any) => `${a.last_name}, ${a.first_name}`).join("; ") || "Unknown Author";
            const year = itemData.year || 0;

            const citation = await prisma.citation.create({
                data: {
                    user_id: colabUserId,
                    project_id: projectId,
                    title: itemData.title || "Untitled",
                    author: authors,
                    year: Number(year),
                    type: itemData.type || "article",
                    doi: itemData.identifiers?.doi || null,
                    url: itemData.websites?.[0] || null,
                    journal: itemData.source,
                    publisher: itemData.publisher,
                    abstract: itemData.abstract,
                    source: "Mendeley",
                    vault_verified: true, // Mark as verified since it comes from their vault
                    formatted_citations: itemData // Store raw Mendeley for high-fidelity export later
                }
            });

            return citation;
        } catch (error: any) {
            console.error("Mendeley Import Error:", error.message);
            throw new Error(`Failed to import Mendeley item: ${error.message}`);
        }
    }
}
