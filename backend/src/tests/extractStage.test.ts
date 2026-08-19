import { ExtractStage } from '../audit/stages/extract';
import { AuditContext, AuditJob } from '../audit/types';

const createJob = (): AuditJob => ({
    auditId: 'audit-1',
    documentId: 'doc-1',
    projectId: 'project-1',
    status: 'RUNNING',
    progress: 0,
    currentStage: 'EXTRACTION',
    startedAt: new Date().toISOString(),
    completedAt: null,
    report: {
        metadata: {
            auditId: 'audit-1',
            timestamp: new Date().toISOString(),
            documentId: 'doc-1',
            projectId: 'project-1',
            style: 'APA',
            version: '1.0.0',
        },
        summary: {
            totalInTextCitations: 0,
            uniqueBibliographyEntries: 0,
            duplicatesDetected: 0,
            brokenCitations: 0,
            uncitedReferences: 0,
            invalidUrls: 0,
            formattingErrors: 0,
            complianceScore: 100,
        },
        issues: [],
        linkValidation: [],
        duplicates: [],
    },
});

describe('ExtractStage', () => {
    it('extracts structured citation nodes and bibliography entries', async () => {
        const job = createJob();
        const context: AuditContext = {
            userId: 'user-1',
            docState: {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            { type: 'text', text: 'Prior work shows this. ' },
                            {
                                type: 'citation',
                                attrs: {
                                    citationId: 'ref-smith-2020',
                                    text: '(Smith, 2020)',
                                },
                            },
                        ],
                    },
                    {
                        type: 'heading',
                        content: [{ type: 'text', text: 'References' }],
                    },
                    {
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'Smith, J. (2020). Prior work.' }],
                    },
                ],
            },
            citations: [],
            bibliography: [],
            citationIdMap: new Map(),
        };

        await ExtractStage.execute(job, context);

        expect(context.citations).toHaveLength(1);
        expect(context.citations[0]).toMatchObject({
            citationId: 'ref-smith-2020',
            text: '(Smith, 2020)',
            source: 'structured',
        });
        expect(context.bibliography).toHaveLength(1);
        expect(context.bibliography[0].text).toContain('Smith, J. (2020)');
    });

    it('extracts manually typed author-year citations and plain reference text', async () => {
        const job = createJob();
        const context: AuditContext = {
            userId: 'user-1',
            docState: {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'Prior work shows this (Smith, 2020).' }],
                    },
                    {
                        type: 'heading',
                        content: [{ type: 'text', text: 'References' }],
                    },
                    {
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'Smith, J. (2020). Prior work.' }],
                    },
                ],
            },
            citations: [],
            bibliography: [],
            citationIdMap: new Map(),
        };

        await ExtractStage.execute(job, context);

        expect(context.citations).toHaveLength(1);
        expect(context.citations[0]).toMatchObject({
            text: '(Smith, 2020)',
            source: 'manual',
        });
        expect(context.bibliography).toHaveLength(1);
    });

    it('extracts bold/plain text inside the references section', async () => {
        const job = createJob();
        const context: AuditContext = {
            userId: 'user-1',
            docState: {
                type: 'doc',
                content: [
                    {
                        type: 'heading',
                        content: [{ type: 'text', text: 'Works Cited' }],
                    },
                    {
                        type: 'paragraph',
                        content: [
                            { type: 'text', text: 'Jones, A. ' },
                            {
                                type: 'text',
                                text: '(2021). Bold reference.',
                                marks: [{ type: 'bold', attrs: {} }],
                            },
                        ],
                    },
                ],
            },
            citations: [],
            bibliography: [],
            citationIdMap: new Map(),
        };

        await ExtractStage.execute(job, context);

        expect(context.bibliography).toHaveLength(1);
        expect(context.bibliography[0].text).toBe('Jones, A. (2021). Bold reference.');
    });
});
