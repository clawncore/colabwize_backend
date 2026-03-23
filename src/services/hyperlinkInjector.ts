import { CitationEngine } from './citationEngine';

export class HyperlinkInjector {
    /**
     * Injects hyperlinks into the provided HTML content based on citation tokens.
     * 
     * @param html The editor HTML content containing <span data-cite="ref_KEY"></span> tokens.
     * @param engine The initialized CitationEngine instance.
     * @returns The HTML with injected hyperlinks.
     */
    public async injectHyperlinks(html: string, engine: CitationEngine): Promise<string> {
        const tokenRegex = /<span\s+data-cite="([^"]+)"[^>]*>(.*?)<\/span>/g;
        const textOnlyRegex = /<span[^>]+data-text="([^"]+)"[^>]*>(.*?)<\/span>/g;

        // 1. Extract all citations with proper IDs
        const tokens: { fullMatch: string, key: string, text: string }[] = [];
        let match;
        while ((match = tokenRegex.exec(html)) !== null) {
            tokens.push({ fullMatch: match[0], key: match[1], text: match[2] });
        }

        // If we have no data-cite tokens, check for data-text citations
        if (tokens.length === 0) {
            // Process text-only citations (no ID linking, just preserve text)
            return html.replace(textOnlyRegex, (fullMatch, text, content) => {
                // Keep the citation text as-is without hyperlink
                return `<span class="citation">${content}</span>`;
            });
        }

        // 2. Format all citations in a single batch to preserve numbering/ibid logic if applicable
        const clusters = tokens.map(t => [t.key]);
        const formattedResults = engine.formatCitations(clusters);

        // 3. Build replacement map (index -> replacement)
        let cursor = 0;
        return html.replace(tokenRegex, (fullMatch, key, existingText) => {
            const text = formattedResults[cursor] || existingText || "[?]";
            const item = engine.getItem(key);

            let href = `#${key}`;
            let target = "_self";
            let cslClass = "citation-link";

            // Integrity Check: Only link externally if we have valid metadata
            // "Invalid citations must default to internal anchors only."
            if (item) {
                if (item.DOI) {
                    href = `https://doi.org/${item.DOI}`;
                    target = "_blank";
                } else if (item.URL) {
                    href = item.URL;
                    target = "_blank";
                }
            }

            cursor++;
            return `<a href="${href}" class="${cslClass}" target="${target}">${text}</a>`;
        });

        // 4. Inject Bibliography
        if (html.includes('[[BIBLIOGRAPHY]]')) {
            const bibEntries = engine.generateBibliography();
            const bibHtml = bibEntries.map(e => `<div class="reference-item">${e.text}</div>`).join('\n');
            const bibContainer = `
                <div class="page-break"></div>
                <div class="references-section">
                    <div class="references-title">References</div>
                    ${bibHtml}
                </div>
            `;
            html = html.replace('[[BIBLIOGRAPHY]]', bibContainer);
        }

        return html;
    }
}
