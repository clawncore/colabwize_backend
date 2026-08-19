
import { CitationEngine } from './services/citationEngine';

async function verify() {
    const citations = [
        {
            id: 'ref_dummy',
            ref_key: 'dummy',
            raw_reference_text: 'Doe, J. (2020). Raw Text Reference.'
            // No csl_data
        },
        {
            id: 'ref_real',
            ref_key: 'real',
            csl_data: {
                id: 'real',
                type: 'article-journal',
                author: [{ family: 'Smith', given: 'John' }],
                title: 'Real Paper',
                issued: { 'date-parts': [[2021]] }
            }
        }
    ];

    const engine = new CitationEngine(citations, 'apa');
    await engine.initialize();

    const content = {
        type: 'doc',
        content: [
            {
                type: 'paragraph',
                content: [
                    { type: 'citation', attrs: { citationId: 'ref_dummy' } },
                    { type: 'citation', attrs: { citationId: 'ref_real' } }
                ]
            }
        ]
    };

    const result = await engine.resolveProject(content);

    console.log('--- Bibliography ---');
    result.bibliography.forEach(entry => {
        console.log(`ID: ${entry.id}, Text: ${entry.text}`);
    });
}

verify().catch(console.error);
