import { randomUUID } from 'crypto';

export interface CitationEntity {
    id: string; // The canonical UUID
    originalText: string;
    type: "ieee" | "apa";
    year?: string;
    authorLabel?: string;
}

export class CitationMappingService {
    /**
     * Main entry point
     * Takes raw HTML/Text from an uploaded document and returns Tiptap JSON
     */
    static parseDocument(rawContent: string, format: "html" | "text"): any {
        // 1. Detect Bibliography
        const { bodyText, bibliographyText } = this.splitBibliography(rawContent, format);

        // 2. Parse Bibliography into Entities
        const entities = this.parseBibliography(bibliographyText);

        // 3. Scan Body and Replace In-Text Citations
        const { bodyJson, usedEntities } = this.mapInTextCitationsToJSON(bodyText, entities, format);

        // 4. Append Bibliography Nodes to JSON
        return this.appendBibliographyToJSON(bodyJson, usedEntities);
    }

    /**
     * Splits the raw document into main body and bibliography section.
     * Scans from the bottom up to find "References", "Bibliography", or "Works Cited".
     */
    private static splitBibliography(content: string, format: "html" | "text") {
        const lines = content.split('\n');
        let splitIndex = -1;

        // Scan bottom-up, looking in the last 20% of the document or max 500 lines
        const scanLimit = Math.max(0, lines.length - 500);

        for (let i = lines.length - 1; i >= scanLimit; i--) {
            // Strip HTML tags if necessary for the check
            const cleanLine = format === "html" ? lines[i].replace(/<[^>]*>/g, '').trim() : lines[i].trim();
            const lowerLine = cleanLine.toLowerCase();

            // Look for standalone headers
            if (
                (lowerLine === "references" || lowerLine === "bibliography" || lowerLine === "works cited") &&
                cleanLine.length < 30 // Ensure it's a header, not a sentence containing the word
            ) {
                splitIndex = i;
                break;
            }
        }

        if (splitIndex === -1) {
            return { bodyText: content, bibliographyText: "" };
        }

        const bodyText = lines.slice(0, splitIndex).join('\n');
        const bibliographyText = lines.slice(splitIndex + 1).join('\n');

        return { bodyText, bibliographyText };
    }

    /**
     * Parses the bibliography text block into unique CitationEntities.
     */
    private static parseBibliography(bibText: string): CitationEntity[] {
        if (!bibText.trim()) return [];

        const entities: CitationEntity[] = [];
        // Split by double newline or typical reference boundary
        // This is a basic split, assumes each paragraph is one reference
        const rawRefs = bibText.split(/\n\s*\n|\n(?=\[\d+\])|\n(?=\d+\.)/);

        for (let i = 0; i < rawRefs.length; i++) {
            const ref = rawRefs[i].trim();
            // Skip HTML markup that might be empty or junk
            const cleanRef = ref.replace(/<[^>]*>/g, '').trim();
            if (cleanRef.length < 10) continue;

            entities.push({
                id: randomUUID(),
                originalText: ref,
                type: /^\[\d+\]|^\d+\./.test(cleanRef) ? "ieee" : "apa"
            });
        }

        return entities;
    }

    /**
     * Scans the body text for citation patterns `[1]` or `(Author, 2020)`.
     * Maps them to canonical IDs from the Bibliography, and constructs Tiptap JSON.
     */
    private static mapInTextCitationsToJSON(bodyText: string, bibliographyEntities: CitationEntity[], format: "html" | "text") {
        const usedEntities = new Map<string, CitationEntity>();

        // 1. Basic text to paragraph conversion
        const paragraphs = bodyText.split(/\n\s*\n/).filter(p => p.trim().length > 0);

        const bodyJson = {
            type: "doc",
            content: [] as any[]
        };

        // Very simplified regexes for the MVP mapping purely by order or author match
        const IEEE_PATTERN = /\[\s*\d+(?:[\s,-]+\d+)*\s*\]/g;
        const APA_PATTERN = /\((?:[^)]+,?\s+)+(?:19|20)\d{2}[a-z]?\)/g;

        let ieeeCounter = 0; // To match sequential [1] to the nth bib entry

        for (const p of paragraphs) {
            if (!p.trim()) continue;

            let textContent = format === "html" ? p.replace(/<[^>]*>/g, '') : p;

            const paragraphNode = {
                type: "paragraph",
                content: [] as any[]
            };

            // Find all matches in this paragraph
            const matches = [];
            let match;

            while ((match = IEEE_PATTERN.exec(textContent)) !== null) {
                matches.push({ type: 'ieee', text: match[0], index: match.index });
            }
            while ((match = APA_PATTERN.exec(textContent)) !== null) {
                matches.push({ type: 'apa', text: match[0], index: match.index });
            }

            // Sort matches by position
            matches.sort((a, b) => a.index - b.index);

            let lastIndex = 0;

            for (const m of matches) {
                // Add text before the citation
                if (m.index > lastIndex) {
                    paragraphNode.content.push({
                        type: "text",
                        text: textContent.substring(lastIndex, m.index)
                    });
                }

                // Map the citation to an entity
                let mappedEntity: CitationEntity | undefined;

                if (m.type === 'ieee') {
                    // For IEEE, try to pull the number
                    const numMatch = m.text.match(/\d+/);
                    if (numMatch) {
                        const num = parseInt(numMatch[0]);
                        // 1-indexed mapping to bibliography array
                        if (num > 0 && num <= bibliographyEntities.length) {
                            mappedEntity = bibliographyEntities[num - 1];
                        }
                    }
                } else if (m.type === 'apa') {
                    // For APA, look for author name and year in the bibliography entries
                    const yearMatch = m.text.match(/(19|20)\d{2}/);
                    const year = yearMatch ? yearMatch[0] : "";

                    // Extremely naive author match (first word without punct)
                    const authorMatch = m.text.match(/\(([A-Z][a-zA-Z]+)/);
                    const author = authorMatch ? authorMatch[1] : "";

                    if (year && author) {
                        mappedEntity = bibliographyEntities.find(ent =>
                            ent.originalText.includes(year) && ent.originalText.includes(author)
                        );
                    }
                }

                // Add citation node
                if (mappedEntity) {
                    usedEntities.set(mappedEntity.id, mappedEntity);
                    paragraphNode.content.push({
                        type: "citation",
                        attrs: {
                            citationId: mappedEntity.id,
                            text: m.text
                        }
                    });
                } else {
                    // If no match found in bibliography, just leave it as text or create a new unresolved bib entry
                    // For MVP: keep as text if not in bibliography
                    paragraphNode.content.push({
                        type: "text",
                        text: m.text
                    });
                }

                lastIndex = m.index + m.text.length;
            }

            // Add trailing text
            if (lastIndex < textContent.length) {
                paragraphNode.content.push({
                    type: "text",
                    text: textContent.substring(lastIndex)
                });
            }

            // If the paragraph ended up empty (e.g. only HTML tags were stripped), don't push
            if (paragraphNode.content.length > 0) {
                bodyJson.content.push(paragraphNode);
            }
        }

        return { bodyJson, usedEntities };
    }

    /**
     * Appends the utilized Bibliography entries to the end of the JSON document.
     */
    private static appendBibliographyToJSON(bodyJson: any, usedEntities: Map<string, CitationEntity>) {
        if (usedEntities.size === 0) return bodyJson;

        // Add a References Header
        bodyJson.content.push({
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "References" }]
        });

        // Add each Bibliography Entry
        usedEntities.forEach((entity, id) => {
            bodyJson.content.push({
                type: "bibliographyEntry",
                attrs: {
                    citationId: id
                },
                content: [
                    {
                        type: "text",
                        text: entity.originalText
                    }
                ]
            });
        });

        return bodyJson;
    }
}
