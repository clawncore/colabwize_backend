
import { CitationEngine } from './services/citationEngine';

async function verify() {
    const citations = [
        {
            id: 'ref_1',
            ref_key: 'smith2020',
            csl_data: {
                id: 'smith2020',
                type: 'article-journal',
                author: [{ family: 'Smith', given: 'John' }],
                title: 'High Potency of Dolutegravir',
                issued: { 'date-parts': [[2020]] },
                DOI: '10.1001/jama.2020.1234'
            }
        },
        {
            id: 'ref_2',
            ref_key: 'jones2021',
            csl_data: {
                id: 'jones2021',
                type: 'article-journal',
                author: [{ family: 'Jones', given: 'Alice' }],
                title: 'Clinical Efficacy of INSTIs',
                issued: { 'date-parts': [[2021]] },
                URL: 'https://example.com/jones2021'
            }
        }
    ];

    const engine = new CitationEngine(citations, 'apa');
    await engine.initialize();

    // Mock document content with two citation nodes (one cluster)
    const content = {
        type: 'doc',
        content: [
            {
                type: 'paragraph',
                content: [
                    { type: 'text', text: 'Some text ' },
                    { type: 'citation', attrs: { citationId: 'ref_1' } },
                    { type: 'text', text: '; ' },
                    { type: 'citation', attrs: { citationId: 'ref_2' } },
                    { type: 'text', text: '.' }
                ]
            }
        ]
    };

    const result = await engine.resolveProject(content);
    console.log('Result type:', typeof result);
    console.log('Result keys:', result ? Object.keys(result) : 'null');

    if (!result || !result.occurrenceMap) {
        throw new Error('resolveProject returned invalid result');
    }

    console.log('--- Occurrence Map ---');
    result.occurrenceMap.forEach((val, key) => {
        console.log(`Node ${key}: ${JSON.stringify(val)}`);
    });

    console.log('\n--- Bibliography ---');
    result.bibliography.forEach(entry => {
        console.log(`ID: ${entry.id}, DOI: ${entry.doi}, URL: ${entry.url}`);
        console.log(`Text: ${entry.text.substring(0, 50)}...`);
    });
}

verify().catch(err => {
    console.error('Verification failed:');
    console.error(err);
    process.exit(1);
});
