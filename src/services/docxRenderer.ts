import * as cheerio from 'cheerio';
import {
    Paragraph,
    TextRun,
    ExternalHyperlink,
    InternalHyperlink,
    BookmarkStart,
    BookmarkEnd,
    HeadingLevel,
    AlignmentType,
    IParagraphOptions
} from 'docx';

export class DocxRenderer {
    /**
     * Converts HTML content and bibliography into DOCX Paragraphs.
     * 
     * @param html The editor HTML content with injected hyperlinks.
     * @param bibEntries Validated bibliography entries with IDs (from CitationEngine).
     * @param style 'apa' or 'ieee' (affects font/size if we were doing full document, but here mainly for context).
     */
    public static async render(html: string, bibEntries: { id: string, text: string }[], style: string = 'apa'): Promise<Paragraph[]> {
        const paragraphs: Paragraph[] = [];
        const $ = cheerio.load(html);

        // 1. Process Body Content
        // We iterate over top-level elements (p, h1, etc.)
        const bodyNodes = $('body').children();

        bodyNodes.each((i, el) => {
            const p = this.processBlockElement($, el);
            if (p) paragraphs.push(p);
        });

        // 2. Process Bibliography
        if (bibEntries && bibEntries.length > 0) {
            // Add Header
            paragraphs.push(new Paragraph({
                text: "References",
                heading: HeadingLevel.HEADING_1,
                pageBreakBefore: true
            }));

            // Process each entry
            for (const entry of bibEntries) {
                // entry.text is HTML wrapped in <div id="ref_KEY">...</div>
                // We parse it to extract text and wrap in Bookmark
                const $bib = cheerio.load(entry.text);
                const div = $bib('div').first();
                const id = div.attr('id') || entry.id;
                const textContent = div.text().trim(); // Basic text extraction for now, or parse children if rich text

                // Create Bookmark around the paragraph
                // Note: docx Bookmarks are usually around runs or whole paragraphs.
                // We will wrap the whole paragraph content.

                // BookmarkStart/End require a unique ID (number) and a name (string) in some docx versions.
                // We generate a unique ID based on the loop index or hash.
                // Fix: ensure ID is number.
                const bookmarkId = bibEntries.indexOf(entry) + 1000; // Offset to avoid collisions

                paragraphs.push(new Paragraph({
                    children: [
                        new BookmarkStart((bookmarkId as any), (id as any)),
                        new TextRun({ text: textContent }),
                        new BookmarkEnd(bookmarkId as any)
                    ],
                    spacing: { after: 120 }
                }));
            }
        }

        return paragraphs;
    }

    private static processBlockElement($: cheerio.CheerioAPI, el: any): Paragraph | null {
        const tag = $(el).prop('tagName')?.toLowerCase();
        // Call the improved recursive processor
        const children = this.processNodesWithStyle($, $(el).contents(), {});

        // Construct formatting options
        let heading: any = undefined;

        if (tag) {
            switch (tag) {
                case 'h1': heading = HeadingLevel.HEADING_1; break;
                case 'h2': heading = HeadingLevel.HEADING_2; break;
                case 'h3': heading = HeadingLevel.HEADING_3; break;
                case 'h4': heading = HeadingLevel.HEADING_4; break;
                case 'p':
                    // standard paragraph
                    break;
            }
        }

        return new Paragraph({
            children,
            heading
        });
    }

    // Improved inline processor that handles nesting
    private static processNodesWithStyle($: cheerio.CheerioAPI, nodes: cheerio.Cheerio<any>, style: { bold?: boolean, italics?: boolean, underline?: boolean }): (TextRun | ExternalHyperlink | InternalHyperlink)[] {
        const elements: (TextRun | ExternalHyperlink | InternalHyperlink)[] = [];

        nodes.each((i, el) => {
            if (el.type === 'text') {
                const text = $(el).text();
                // Avoid empty text runs unless significant
                if (text) {
                    elements.push(new TextRun({
                        text: text,
                        bold: style.bold,
                        italics: style.italics,
                        underline: style.underline ? {} : undefined,
                    }));
                }
            } else if (el.type === 'tag') {
                const tag = $(el).prop('tagName')?.toLowerCase();

                if (tag === 'a') {
                    // Hyperlink
                    const href = $(el).attr('href') || '#';
                    // Recurse with same style
                    const children = this.processNodesWithStyle($, $(el).contents(), style);
                    const textRuns = children.filter(c => c instanceof TextRun) as TextRun[];

                    if (href.startsWith('#')) {
                        // Internal Link
                        // Note: InternalHyperlink anchor usually refers to a bookmark name.
                        elements.push(new InternalHyperlink({
                            anchor: href.substring(1),
                            children: textRuns,
                            // docx adds implicit styling (Hyperlink style) usually.
                        }));
                    } else {
                        // External Link
                        elements.push(new ExternalHyperlink({
                            link: href,
                            children: textRuns
                        }));
                    }
                } else if (tag === 'br') {
                    // Hard break
                    elements.push(new TextRun({ text: "", break: 1 }));
                } else {
                    // Formatting
                    const newStyle = { ...style };
                    if (tag === 'b' || tag === 'strong') newStyle.bold = true;
                    if (tag === 'i' || tag === 'em') newStyle.italics = true;
                    if (tag === 'u') newStyle.underline = true;

                    elements.push(...this.processNodesWithStyle($, $(el).contents(), newStyle));
                }
            }
        });

        return elements;
    }
}
