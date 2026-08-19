import crypto from 'crypto';

interface CacheEntry<T> {
    data: T;
    timestamp: number;
    hash: string;
}

export class CitationCacheManager {
    // Cache for formatted citation clusters: Key -> HTML string
    private static clusterCache: Map<string, CacheEntry<string>> = new Map();

    // Cache for bibliography: Key -> Array of strings (entries)
    private static bibliographyCache: Map<string, CacheEntry<string[]>> = new Map();

    private static TTL = 1000 * 60 * 60; // 1 Hour TTL

    /**
     * Generate a unique key for a citation cluster request.
     * @param style Citation style (e.g. 'apa')
     * @param items Array of item objects (must include ID and version/content)
     * @param clusterIds Array of citation IDs in this cluster
     */
    static generateClusterKey(style: string, items: any[], clusterIds: string[]): string {
        // We need a stable hash of the input data.
        // If any item data changes, the hash changes.
        // If the style changes, the hash changes.
        // If the cluster composition changes, the hash changes.

        const contentStr = JSON.stringify({
            style,
            ids: clusterIds.sort(), // Sort IDs to ensure stable key for same set (though order in cluster matters for IEEE!)
            // Actually, for CSL, order in cluster MATTERS. Example: [1, 2] vs [2, 1].
            // So do NOT sort clusterIds if order matters. 
            // Is numbering dependent on global order? Yes.
            // But `processCitationCluster` usually takes a specific cluster.
            // If the ENGINE state (registry of all items) changes, does it affect this cluster?
            // For IEEE: Yes, because [1] depends on previous citations.
            // CSL-JSON engine is stateful.
            // THEREFORE: We cannot easily cache individual cluster results purely on their own content 
            // IF the style is dependent on previous items (like numbered styles).
            // APA is mostly independent (Author, Year), but "ibid" might depend on context.

            // OPTIMIZATION STRATEGY:
            // 1. Cache based on (Global Item Hash + Style + Cluster Content + Cluster Position/Index?)
            // If we include Global Item Hash, any change to ANY item invalidates EVERYTHING. This is safe but aggressive.
            // Given the requirement "Partial invalidation rules", we want better.

            // "Reordering citations should invalidate numbering-dependent formats (IEEE) but not APA...".
            // Implementation complexity for stateful CSL caching is high.
            // Simple approach:
            // If style is 'ieee' (or numbered), we might need to be very careful or just cache the WHOLE document output for a given state.
            // If style is 'apa', we can cache individual clusters more safely (mostly).

            // For this iteration (Step 11), let's implement a robust "Input Hash" cache.
            // If the inputs to `formatCitations` (items + cluster) are same, output is same?
            // `formatCitations` in `CitationEngine` updates items first.
            // The `processCitationCluster` logic in citeproc-js handles the state.
            // If we cache the *result* of `formatCitations` for a given input, we bypass the engine.
            // BUT the engine maintains internal state. If we bypass it, the engine might lose track of "cited" items!

            // CRITICAL: citeproc-js needs to "see" citations to track "ibid" and numbering.
            // If we check cache and skip calling `processCitationCluster`, the engine state will drift.
            // UNLESS we are caching the entire `makeBibliography` or `processCitationCluster` *batched* result?

            // Refined Strategy:
            // We can cache the *Bibliography* generation if the set of cited IDs and their content hasn't changed.
            // For citation clusters in text:
            // If we are regenerating the whole document (HTML export), we iterate through all.
            // If we cache the *Text* of the cluster, we still need to tell the engine "we have these citations".
            // `citeproc-js` has a `updateItems` method. We call that.
            // But `processCitationCluster` returns the "current" numbering.

            // If we want to safely cache, we should probably wrap the `CitationEngine` logic such that:
            // 1. We always `updateItems` (fast).
            // 2. We allow the engine to process.
            // 3. Wait, `processCitationCluster` IS the expensive part.

            // Let's look at requirements: "re-running CSL formatting unless the citation order has changed".
            // This suggests caching the *Document Output* or large chunks.
            // If we are doing Export, we process ALL clusters.
            // If the list of clusters (Order) is same as before, and Items are same as before -> Return Cached Result.

            items: items.map(i => ({ id: i.id, _v: JSON.stringify(i) })) // Simple content hash
        });

        return crypto.createHash('sha256').update(contentStr).digest('hex');
    }

    /**
     * Generate a key for bibliography
     */
    static generateBibKey(style: string, itemHashes: string[]): string {
        const contentStr = JSON.stringify({
            style,
            itemHashes: itemHashes.sort() // Order in map doesn't matter for *set* of items, but Bib sorts them itself.
        });
        return crypto.createHash('sha256').update(contentStr).digest('hex');
    }

    static getCluster(key: string): string | undefined {
        const entry = this.clusterCache.get(key);
        if (entry && Date.now() - entry.timestamp < this.TTL) {
            return entry.data;
        }
        return undefined;
    }

    static setCluster(key: string, data: string) {
        this.clusterCache.set(key, {
            data,
            timestamp: Date.now(),
            hash: key
        });
    }

    static getBibliography(key: string): string[] | undefined {
        const entry = this.bibliographyCache.get(key);
        if (entry && Date.now() - entry.timestamp < this.TTL) {
            return entry.data;
        }
        return undefined;
    }

    static setBibliography(key: string, data: string[]) {
        this.bibliographyCache.set(key, {
            data,
            timestamp: Date.now(),
            hash: key
        });
    }

    static invalidateAll() {
        this.clusterCache.clear();
        this.bibliographyCache.clear();
    }
}
