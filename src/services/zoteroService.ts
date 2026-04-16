import axios from "axios";
import { prisma } from "../lib/prisma.js";
import { normalizeToCSL } from "../utils/cslNormalization.js";
import logger from "../monitoring/logger.js";

export class ZoteroService {
    private static BATCH_SIZE = 50;

    /**
     * Fetch user's Zotero library in CSL-JSON format
     */
    static async fetchLibrary(zoteroUserId: string, zoteroApiKey: string, limit: number = 50, start: number = 0) {
        try {
            logger.info(`[Zotero Service] Fetching library for user ${zoteroUserId} (limit: ${limit}, start: ${start})`);
            const url = `https://api.zotero.org/users/${zoteroUserId}/items?limit=${limit}&start=${start}`;
            
            const response = await axios.get(url, {
                headers: {
                    'Zotero-API-Key': zoteroApiKey
                }
            });

            return response.data; // Array of CSL-JSON items
        } catch (error: any) {
            console.error("Zotero API Error:", error.response?.data || error.message);
            throw new Error(`Failed to fetch Zotero library: ${error.message}`);
        }
    }
 
    /**
     * Search user's library by DOI, ISBN or Title
     */
    static async queryItems(zoteroUserId: string, zoteroApiKey: string, query: string) {
        try {
            const url = `https://api.zotero.org/users/${zoteroUserId}/items?q=${encodeURIComponent(query)}`;
            
            const response = await axios.get(url, {
                headers: { 'Zotero-API-Key': zoteroApiKey }
            });

            return response.data;
        } catch (error: any) {
            console.error("Zotero Query Error:", error.response?.data || error.message);
            throw new Error(`Failed to query Zotero: ${error.message}`);
        }
    }

    /**
     * Fetch child attachments (PDFs, notes) for a specific item
     */
    static async fetchAttachments(zoteroUserId: string, zoteroApiKey: string, itemKey: string) {
        try {
            const url = `https://api.zotero.org/users/${zoteroUserId}/items/${itemKey}/children`;
            
            const response = await axios.get(url, {
                headers: { 'Zotero-API-Key': zoteroApiKey }
            });

            return response.data;
        } catch (error: any) {
            console.error("Zotero Attachments Error:", error.response?.data || error.message);
            throw new Error(`Failed to fetch Zotero attachments: ${error.message}`);
        }
    }

    /**
     * Get bibliography strings for specific items in a chosen CSL style
     */
    static async fetchFormattedBib(zoteroUserId: string, zoteroApiKey: string, itemKey: string, style: string = 'apa') {
        try {
            const url = `https://api.zotero.org/users/${zoteroUserId}/items/${itemKey}?include=bib&style=${style}`;
            
            const response = await axios.get(url, {
                headers: { 'Zotero-API-Key': zoteroApiKey }
            });

            return response.data;
        } catch (error: any) {
            console.error("Zotero Formatting Error:", error.response?.data || error.message);
            throw new Error(`Failed to fetch formatted bibliography: ${error.message}`);
        }
    }

    /**
     * Update an existing Zotero item (metadata or notes)
     */
    static async updateItem(zoteroUserId: string, zoteroApiKey: string, itemKey: string, updateData: any) {
        try {
            const url = `https://api.zotero.org/users/${zoteroUserId}/items/${itemKey}`;
            
            // Get current version first (important for Zotero updates)
            const currentResponse = await axios.get(url, {
                headers: { 'Zotero-API-Key': zoteroApiKey }
            });
            const currentVersion = currentResponse.headers['last-modified-version'] || 
                                   currentResponse.headers['Last-Modified-Version'] || 
                                   currentResponse.data.version;

            const response = await axios.patch(url, updateData, {
                headers: { 
                    'Zotero-API-Key': zoteroApiKey,
                    'If-Unmodified-Since-Version': currentVersion,
                    'Content-Type': 'application/json'
                }
            });

            return response.data;
        } catch (error: any) {
            console.error("Zotero Update Error:", error.response?.data || error.message);
            throw new Error(`Failed to update Zotero item: ${error.message}`);
        }
    }

    /**
     * Create a new item in Zotero
     */
    static async createItem(zoteroUserId: string, zoteroApiKey: string, itemData: any) {
        try {
            const url = `https://api.zotero.org/users/${zoteroUserId}/items`;
            
            // Zotero expects an array for item creation even for a single item
            const response = await axios.post(url, [itemData], {
                headers: { 
                    'Zotero-API-Key': zoteroApiKey,
                    'Content-Type': 'application/json'
                }
            });

            return response.data;
        } catch (error: any) {
            console.error("Zotero Create Item Error:", error.response?.data || error.message);
            throw new Error(`Failed to create Zotero item: ${error.message}`);
        }
    }

    /**
     * Create a child note for a Zotero item
     */
    static async createNote(zoteroUserId: string, zoteroApiKey: string, parentKey: string, noteText: string) {
        try {
            const url = `https://api.zotero.org/users/${zoteroUserId}/items`;
            
            const noteItem = {
                itemType: 'note',
                parentItem: parentKey,
                note: noteText
            };

            const response = await axios.post(url, [noteItem], {
                headers: { 
                    'Zotero-API-Key': zoteroApiKey,
                    'Content-Type': 'application/json'
                }
            });

            return response.data;
        } catch (error: any) {
            console.error("Zotero Create Note Error:", error.response?.data || error.message);
            throw new Error(`Failed to create Zotero note: ${error.message}`);
        }
    }

    /**
     * Fetch user's Zotero collections
     */
    static async fetchCollections(zoteroUserId: string, zoteroApiKey: string) {
        try {
            const url = `https://api.zotero.org/users/${zoteroUserId}/collections`;
            const response = await axios.get(url, {
                headers: { 'Zotero-API-Key': zoteroApiKey }
            });
            return response.data; // Array of collection objects
        } catch (error: any) {
            console.error("Zotero Collections Error:", error.response?.data || error.message);
            throw new Error(`Failed to fetch Zotero collections: ${error.message}`);
        }
    }

    /**
     * Fetch items from a specific Zotero collection
     */
    static async fetchCollectionItems(zoteroUserId: string, zoteroApiKey: string, collectionKey: string, limit: number = 50, start: number = 0) {
        try {
            const url = `https://api.zotero.org/users/${zoteroUserId}/collections/${collectionKey}/items?limit=${limit}&start=${start}`;
            const response = await axios.get(url, {
                headers: { 'Zotero-API-Key': zoteroApiKey }
            });
            return response.data;
        } catch (error: any) {
            console.error("Zotero Collection Items Error:", error.response?.data || error.message);
            throw new Error(`Failed to fetch Zotero collection items: ${error.message}`);
        }
    }

    /**
     * Import a Zotero item into the project's citation list
     */
    static async importItem(colabUserId: string, projectId: string, itemData: any) {
        try {
            // Unbox native Zotero JSON if wrapped in data object
            const targetData = itemData.data ? { ...itemData.data, authors: itemData.meta?.creatorSummary } : itemData;
            
            // 1. Normalize CSL data
            const csl = normalizeToCSL(targetData);

            const authors = csl.author?.map((a: any) => a.family || a.literal).join(", ") || "Unknown Author";
            const year = csl.issued?.["date-parts"]?.[0]?.[0] || parseInt(csl.year) || 0;

            const citation = await prisma.citation.create({
                data: {
                    user_id: colabUserId,
                    project_id: projectId,
                    title: csl.title || "Untitled",
                    author: authors,
                    year: Number(year),
                    type: csl.type || "article",
                    doi: csl.DOI || csl.doi,
                    url: csl.URL || csl.url,
                    journal: csl["container-title"],
                    publisher: csl.publisher,
                    abstract: csl.abstract,
                    source: "Zotero",
                    vault_verified: true, // Mark as verified since it comes from their vault
                    formatted_citations: itemData // Store raw Zotero for high-fidelity export later
                }
            });

            return citation;
        } catch (error: any) {
            console.error("Zotero Import Error:", error.message);
            throw new Error(`Failed to import Zotero item: ${error.message}`);
        }
    }
}
