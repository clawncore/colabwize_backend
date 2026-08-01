"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CitationEngine = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const citeproc_1 = __importDefault(require("citeproc"));
const client_1 = require("@prisma/client");
const citationCacheManager_js_1 = require("./citationCacheManager.js");
const cslNormalization_js_1 = require("../utils/cslNormalization.js");
const prisma = new client_1.PrismaClient();
// Initial styles paths
const CSL_DIR = path_1.default.join(process.cwd(), 'src', 'assets', 'csl');
const LOCALE_URL = 'https://raw.githubusercontent.com/citation-style-language/locales/master/locales-en-US.xml';
const STYLES_URL = 'https://raw.githubusercontent.com/citation-style-language/styles/master';
// Ensure CSL directory exists
if (!fs_1.default.existsSync(CSL_DIR)) {
    fs_1.default.mkdirSync(CSL_DIR, { recursive: true });
}
class CitationEngine {
    style;
    sys;
    citeproc; // CSL.Engine type is complex, using any for now
    localeXml = "";
    styleXml = "";
    items = new Map();
    constructor(itemsOrStyle = [], style = 'apa') {
        if (typeof itemsOrStyle === 'string') {
            this.style = itemsOrStyle;
            this.items = new Map();
        }
        else {
            this.style = style;
            if (itemsOrStyle) {
                // Pre-load items
                itemsOrStyle.forEach(item => {
                    const csl = (0, cslNormalization_js_1.normalizeToCSL)(item);
                    if (item.id)
                        this.items.set(item.id, csl);
                    if (item.csl_data?.id)
                        this.items.set(item.csl_data.id, csl);
                    if (item.ref_key)
                        this.items.set(item.ref_key, csl);
                });
            }
        }
        // Basic Sys implementation required by citeproc-js
        this.sys = {
            retrieveLocale: (lang) => this.localeXml,
            retrieveItem: (id) => {
                const item = this.items.get(id);
                if (item)
                    return { ...item, id: id };
                return undefined;
            }
        };
    }
    /**
     * Initialize the engine with Style, Locale, and Items
     */
    async initialize(citationIds, projectId) {
        // 1. Load Locale
        await this.loadLocale();
        // 2. Load Style
        await this.loadStyle(this.style);
        // 3. Load Items (CSL-JSON) from DB if requested
        if (projectId && citationIds) {
            await this.loadItemsFromDB(projectId, citationIds);
        }
        // 4. Create Processor
        // @ts-ignore - CSL constructor type definition might be slightly off in imports
        this.citeproc = new citeproc_1.default.Engine(this.sys, this.styleXml);
    }
    async loadLocale() {
        const localePath = path_1.default.join(CSL_DIR, 'locales-en-US.xml');
        if (fs_1.default.existsSync(localePath)) {
            this.localeXml = fs_1.default.readFileSync(localePath, 'utf-8');
        }
        else {
            try {
                // Fetch using global fetch (Node 18+)
                const res = await fetch(LOCALE_URL);
                if (res.ok) {
                    this.localeXml = await res.text();
                    fs_1.default.writeFileSync(localePath, this.localeXml); // Cache it
                }
                else {
                    throw new Error("Failed to fetch locale");
                }
            }
            catch (e) {
                console.error("Locale load failed", e);
                // Minimal fallback
                this.localeXml = `<?xml version="1.0" encoding="utf-8"?><locale xmlns="http://purl.org/net/xbiblio/csl" version="1.0" xml:lang="en-US"/>`;
            }
        }
    }
    async loadStyle(styleId) {
        const stylePath = path_1.default.join(CSL_DIR, `${styleId}.csl`);
        if (fs_1.default.existsSync(stylePath)) {
            this.styleXml = fs_1.default.readFileSync(stylePath, 'utf-8');
        }
        else {
            try {
                // Determine URL based on style ID (apa -> apa, ieee -> ieee)
                const url = `${STYLES_URL}/${styleId}.csl`;
                console.log(`Fetching style from ${url}`);
                const res = await fetch(url);
                if (res.ok) {
                    this.styleXml = await res.text();
                    fs_1.default.writeFileSync(stylePath, this.styleXml);
                }
                else {
                    throw new Error(`Style ${styleId} not found at ${url}`);
                }
            }
            catch (e) {
                console.error(`Style load failed for ${styleId}`, e);
                throw e;
            }
        }
    }
    async loadItemsFromDB(projectId, citationIds) {
        // Fetch project to get citations array
        const project = await prisma.project.findUnique({
            where: { id: projectId },
            select: { citations: true }
        });
        if (!project || !project.citations)
            return;
        const citations = project.citations;
        // Populate items map
        // We initialize with ALL citations in the project so the processor has access to everything
        // But specifically ensure requested IDs are present
        citations.forEach(c => {
            const csl = (0, cslNormalization_js_1.normalizeToCSL)(c);
            if (c.id)
                this.items.set(c.id, csl);
            if (c.csl_data?.id)
                this.items.set(c.csl_data.id, csl);
            if (c.ref_key)
                this.items.set(c.ref_key, csl);
        });
    }
    /**
     * Format a list of citation clusters (e.g. [['ref_1'], ['ref_2', 'ref_3']])
     * Returns: Array of formatted citation objects corresponding to input clusters.
     */
    formatCitations(citationClusters) {
        if (!this.citeproc)
            throw new Error("Engine not initialized");
        // --- Caching Check ---
        // We cache the entire Batch Result based on Inputs
        const itemsList = Array.from(this.items.values());
        // Flatten clusters for cache key usage
        const flatClusters = citationClusters.map(c => c.join(','));
        const cacheKey = citationCacheManager_js_1.CitationCacheManager.generateClusterKey(this.style, itemsList, flatClusters);
        // We reuse `getCluster` but we need to cast/parse since we are storing Array<string> actually for batch?
        // Wait, `CacheManager` defined `clusterCache` as `CacheEntry<string>`.
        // I need to update CacheManager to support Array storage or stringify.
        // Let's standard JSON stringify the result array for storage.
        const cached = citationCacheManager_js_1.CitationCacheManager.getCluster(cacheKey);
        if (cached) {
            console.log("⚡ Citation Cache Hit (Format)");
            return JSON.parse(cached);
        }
        console.log("⚙️ Running CSL Processing...");
        // Clear previous state and update with ONLY used items for numbering accuracy
        const allIdsInClusters = Array.from(new Set(citationClusters.flat()));
        this.citeproc.updateItems(allIdsInClusters);
        const results = [];
        // Process each cluster sequentially
        for (let i = 0; i < citationClusters.length; i++) {
            const clusterIds = citationClusters[i];
            // Validate IDs exist
            const validIds = clusterIds.filter(id => this.items.has(id));
            if (validIds.length === 0) {
                results.push({ text: "[?]" });
                continue;
            }
            const cluster = {
                citationID: `cit_${i}`,
                citationItems: validIds.map(id => ({ id })),
                properties: { noteIndex: i + 1 }
            };
            // processCitationCluster returns a list of [citationID, text, index] tuples for changed citations
            // We are interested in the text for the current citationID
            const updates = this.citeproc.processCitationCluster(cluster, [], []);
            // updates[1] contains the list of [ [citationID, noteIndex, text], ... ]
            const changes = updates[1];
            // Isolate the text for the current cluster
            const currentChange = changes.find((c) => c[0] === `cit_${i}`);
            // Get DOI/URL for the first item in the cluster for hyperlinking
            const firstId = validIds[0];
            const firstItem = this.items.get(firstId);
            const doi = firstItem?.DOI || firstItem?.doi;
            const url = firstItem?.URL || firstItem?.url;
            if (currentChange) {
                results.push({
                    text: currentChange[2],
                    doi,
                    url
                });
            }
            else {
                // FALLBACK: If citeproc fails to format, use a basic (Author, Year) fallback 
                if (firstItem) {
                    const author = firstItem.author?.[0]?.family || firstItem.author?.[0]?.literal || firstItem.title || "Unknown";
                    const year = firstItem.issued?.["date-parts"]?.[0]?.[0] || firstItem.year || "n.d.";
                    results.push({
                        text: `(${author}, ${year})`,
                        doi,
                        url
                    });
                }
                else {
                    const fallbackAuthor = firstId.split('_')[0] || "Unknown";
                    results.push({
                        text: `(${fallbackAuthor}, n.d.)`,
                        doi,
                        url
                    });
                }
            }
        }
        // Cache Result
        citationCacheManager_js_1.CitationCacheManager.setCluster(cacheKey, JSON.stringify(results));
        return results;
    }
    /**
     * Resolve all citations in a project document in document order.
     * Handles clustering of adjacent citation nodes.
     * Returns a map of occurrence index to formatted string, and structured bibliography.
     */
    async resolveProject(content) {
        if (!this.citeproc)
            throw new Error("Engine not initialized");
        // 1. Traverse document to find all citation clusters
        const clusters = [];
        const usedIds = new Set();
        let currentCluster = [];
        let citationNodeCount = 0;
        const walk = (node) => {
            if (!node)
                return;
            if (node.type === 'citation') {
                const id = node.attrs?.citationId;
                if (id && this.items.get(id)) {
                    currentCluster.push(id);
                    usedIds.add(id);
                }
                else {
                    // Fallback for missing ID or metadata
                    if (currentCluster.length > 0) {
                        clusters.push([...currentCluster]);
                        currentCluster = [];
                    }
                    clusters.push([id || "unknown"]);
                }
                citationNodeCount++;
            }
            else if (node.type === 'text' && (node.text === '; ' || node.text === ', ' || node.text === ';')) {
                // Potential cluster bridge - keep currentCluster open
            }
            else if (node.content && Array.isArray(node.content)) {
                // If it's a block node, we might want to break clusters between them
                const isBlock = ['paragraph', 'heading', 'listItem', 'tableCell'].includes(node.type);
                for (const child of node.content) {
                    walk(child);
                    // After each child, if it wasn't a citation or bridge, break cluster
                    if (child.type !== 'citation' && !(child.type === 'text' && (child.text === '; ' || child.text === ', ' || child.text === ';'))) {
                        if (currentCluster.length > 0) {
                            clusters.push([...currentCluster]);
                            currentCluster = [];
                        }
                    }
                }
                if (isBlock && currentCluster.length > 0) {
                    clusters.push([...currentCluster]);
                    currentCluster = [];
                }
            }
        };
        walk(content);
        if (currentCluster.length > 0) {
            clusters.push([...currentCluster]);
        }
        // 2. Format all clusters in sequence
        const formattedResults = this.formatCitations(clusters);
        // 3. Map cluster results back to nodes
        // If a cluster has multiple entries, the first node gets the text, others get empty string
        const occurrenceMap = new Map();
        let clusterIdx = 0;
        let nodeInClusterIdx = 0;
        for (let i = 0; i < citationNodeCount; i++) {
            if (nodeInClusterIdx === 0) {
                occurrenceMap.set(i, formattedResults[clusterIdx]);
            }
            else {
                occurrenceMap.set(i, { text: "" });
            }
            nodeInClusterIdx++;
            if (nodeInClusterIdx >= (clusters[clusterIdx]?.length || 1)) {
                clusterIdx++;
                nodeInClusterIdx = 0;
            }
        }
        // 4. Generate Bibliography
        const bibliography = this.generateBibliography(usedIds);
        return { occurrenceMap, bibliography };
    }
    /**
     * Generate Bibliography
     */
    getItem(id) {
        return this.items.get(id);
    }
    /**
     * Generate Bibliography
     */
    generateBibliography(usedIds) {
        if (!this.citeproc)
            throw new Error("Engine not initialized");
        // --- Caching Check ---
        const itemHashes = Array.from(this.items.values()).map(i => JSON.stringify(i));
        const cacheKey = citationCacheManager_js_1.CitationCacheManager.generateBibKey(this.style, itemHashes);
        // CacheManager stores <string[]> for bib?
        // Wait, CacheManager defined `bibliographyCache` as `CacheEntry<string[]>`. 
        // But here we return object array `{ id, text }`.
        // I'll cache the serialized object array in the bibliography cache (as string[] won't fit exactly if typed strict, but let's assume JSON stringify again or update manager).
        // Actually CacheManager typed it string[].
        // I'll just store JSON string of the object array in `clusterCache` (using generateKey) OR update CacheManager.
        // Let's assume `bibliographyCache` stores the final object array for simplicity?
        // No, I'll stick to `string[]` in manager for "lines", but here we have objects.
        // Let's just JSON.stringify and store in a generic way.
        // For expediency, I will cast the manager's retrieve/store to `any` or stringify.
        const cached = citationCacheManager_js_1.CitationCacheManager.getBibliography(cacheKey);
        if (cached) {
            console.log("⚡ Bibliography Cache Hit");
            // @ts-ignore - Assuming we store the object array and cast it back
            // Actually `getBibliography` return `string[]`. 
            // Let's change the manager to store `any`? Or just use one generic cache method.
            // I'll update CacheManager next? No, just hack the transform here.
            // If I store `JSON.stringify(result)` in a String cache, it works.
            // I'll use `getCluster` (which returns string) for bib too? No, different map.
            // Check: `getBibliography` returns `string[]`. 
            // If I store `JSON.stringify` result (string) in `bibliographyCache`, I need to change signature.
            // Let's just use `getCluster` (string cache) for EVERYTHING if I want to store JSON.
            // `generateBibKey` returns a string key.
            const cachedJson = citationCacheManager_js_1.CitationCacheManager.getCluster(cacheKey); // Re-using string cache container
            if (cachedJson)
                return JSON.parse(cachedJson);
        }
        if (usedIds && usedIds.size === 0)
            return [];
        const bib = this.citeproc.makeBibliography(usedIds ? { entry_ids: Array.from(usedIds) } : undefined);
        // bib[0] is formatting parameters and entry_ids: { "entry_ids": [...] }
        // bib[1] is array of bibliography entries strings
        if (!bib || !bib[1])
            return [];
        const entryIds = bib[0].entry_ids || [];
        const result = bib[1].map((entry, index) => {
            const entryId = entryIds[index];
            const cleanId = String(entryId).trim();
            const item = this.items.get(cleanId);
            let finalText = entry.trim();
            // If it was a dummy item OR if citeproc produced "Unknown Author/Untitled" garbage, prefer raw text
            const isJunk = finalText.toLowerCase().includes("unknown author") ||
                finalText.toLowerCase().includes("untitled") ||
                finalText.replace(/<[^>]*>/g, "").length < 10; // Very short text after stripping HTML
            if ((item?._is_dummy || isJunk) && item?.raw_text) {
                finalText = item.raw_text;
            }
            return {
                id: cleanId,
                text: finalText,
                doi: item?.DOI || item?.doi,
                url: item?.URL || item?.url
            };
        });
        // Cache Result (as JSON string in the string-cache container)
        citationCacheManager_js_1.CitationCacheManager.setCluster(cacheKey, JSON.stringify(result));
        return result;
    }
    /**
     * Get all items in CSL-JSON format for Pandoc
     */
    getAllItems() {
        return Array.from(this.items.values());
    }
}
exports.CitationEngine = CitationEngine;
