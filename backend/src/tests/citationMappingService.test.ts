import { CitationMappingService } from '../services/citationMappingService';

describe('CitationMappingService', () => {
    describe('splitBibliography', () => {
        it('splits body and bibliography when "References" header is present', () => {
            const rawText = `This is the body.
It has multiple lines.

References
Smith, J. (2020). A great paper.
Jones, A. (2021). Another paper.`;

            // We access the private method for testing purposes via any.
            const result = (CitationMappingService as any).splitBibliography(rawText, 'text');

            expect(result.bodyText.trim()).toContain('This is the body.');
            expect(result.bibliographyText.trim()).toContain('Smith, J.');
        });

        it('returns empty bibliography if no header is found', () => {
            const rawText = `This is just a document without a bibliography.`;

            const result = (CitationMappingService as any).splitBibliography(rawText, 'text');

            expect(result.bibliographyText.trim()).toBe('');
            expect(result.bodyText).toBe(rawText);
        });
    });

    describe('parseDocument with IEEE', () => {
        it('maps sequential IEEE citations to bibliography entities', () => {
            const rawText = `We know that AI is good [1]. We also know dogs are good [2].

References
[1] Smith, J. (2020). AI paper.
[2] Jones, A. (2021). Dog paper.`;

            const result = CitationMappingService.parseDocument(rawText, 'text');

            const p1 = result.content[0];
            // Should be: We know that AI is good -> citation -> . We also know dogs are good -> citation -> .
            expect(p1.content.length).toBeGreaterThan(2);

            const cit1 = p1.content.find((n: any) => n.type === 'citation' && n.attrs.text === '[1]');
            const cit2 = p1.content.find((n: any) => n.type === 'citation' && n.attrs.text === '[2]');

            expect(cit1).toBeDefined();
            expect(cit2).toBeDefined();

            // Look at the generated bibliography
            const referencesHeader = result.content.find((n: any) => n.type === 'heading' && n.content[0].text === 'References');
            expect(referencesHeader).toBeDefined();

            const bibEntries = result.content.filter((n: any) => n.type === 'bibliographyEntry');
            expect(bibEntries.length).toBe(2);

            // Validate mapping: citation 1 matches bib entry 1
            const bib1 = bibEntries.find((b: any) => b.content[0].text.includes('[1]'));
            expect(cit1.attrs.citationId).toBe(bib1.attrs.citationId);

            const bib2 = bibEntries.find((b: any) => b.content[0].text.includes('[2]'));
            expect(cit2.attrs.citationId).toBe(bib2.attrs.citationId);
        });

        it('reuses the same canonical ID for repeated citations', () => {
            const rawText = `First claim [1]. Second claim [1].

References
[1] Smith, J. (2020). AI paper.`;

            const result = CitationMappingService.parseDocument(rawText, 'text');

            const p1 = result.content[0];
            const citations = p1.content.filter((n: any) => n.type === 'citation');

            expect(citations.length).toBe(2);
            // Both [1]s should have exactly the same canonical ID
            expect(citations[0].attrs.citationId).toBe(citations[1].attrs.citationId);
        });
    });
});
