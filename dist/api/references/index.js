"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const hybridAuthMiddleware_js_1 = require("../../middleware/hybridAuthMiddleware.js");
const prisma_js_1 = require("../../lib/prisma.js");
const zoteroService_js_1 = require("../../services/zoteroService.js");
const mendeleyService_js_1 = require("../../services/mendeleyService.js");
const citationNormalizer_js_1 = require("../../utils/citationNormalizer.js");
const logger_js_1 = __importDefault(require("../../monitoring/logger.js"));
const router = express_1.default.Router();
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Extract the authenticated user ID from the request. */
function getUserId(req) {
    return req.user?.id ?? '';
}
/** Wrap async route handlers so rejected promises hit Express error middleware. */
function asyncHandler(fn) {
    return (req, res) => {
        fn(req, res).catch((err) => {
            logger_js_1.default.error(`[References API] Unhandled error: ${err?.message}`, err);
            if (!res.headersSent) {
                res.status(500).json({ success: false, error: 'Internal server error' });
            }
        });
    };
}
/** Validate and parse a provider string. */
function parseProvider(value) {
    if (value === undefined || value === null)
        return null;
    const v = String(value).toLowerCase();
    if (v === 'zotero' || v === 'mendeley' || v === 'manual' || v === 'crossref') {
        return v;
    }
    return null;
}
/** Parse a positive integer query param with a default. */
function parsePositiveInt(value, fallback) {
    const n = parseInt(String(value), 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}
// ---------------------------------------------------------------------------
// GET / — list / search citations
// ---------------------------------------------------------------------------
router.get('/', hybridAuthMiddleware_js_1.authenticateHybridRequest, asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const { projectId, provider, search, isFavorite, cursor, } = req.query;
    const take = parsePositiveInt(req.query.limit, 50);
    if (!projectId) {
        return res.status(400).json({ success: false, error: 'projectId is required' });
    }
    const where = {
        project_id: String(projectId),
        user_id: userId,
    };
    const parsedProvider = parseProvider(provider);
    if (parsedProvider) {
        where.provider = parsedProvider;
    }
    if (isFavorite !== undefined) {
        where.isFavorite = isFavorite === 'true' || isFavorite === '1';
    }
    if (search) {
        const q = String(search);
        where.OR = [
            { title: { contains: q, mode: 'insensitive' } },
            { author: { contains: q, mode: 'insensitive' } },
            { abstract: { contains: q, mode: 'insensitive' } },
            { doi: { contains: q, mode: 'insensitive' } },
        ];
    }
    // Cursor pagination
    const findOptions = {
        where,
        take: take + 1, // fetch one extra to determine next cursor
        orderBy: { created_at: 'desc' },
    };
    if (cursor) {
        findOptions.cursor = { id: String(cursor) };
        findOptions.skip = 1; // skip the cursor itself
    }
    const citations = await prisma_js_1.prisma.citation.findMany(findOptions);
    let nextCursor = null;
    if (citations.length > take) {
        const nextItem = citations.pop();
        nextCursor = nextItem?.id ?? null;
    }
    return res.status(200).json({
        success: true,
        data: citations,
        nextCursor,
    });
}));
// ---------------------------------------------------------------------------
// GET /:id — single citation
// ---------------------------------------------------------------------------
router.get('/:id', hybridAuthMiddleware_js_1.authenticateHybridRequest, asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const { id } = req.params;
    const citation = await prisma_js_1.prisma.citation.findFirst({
        where: { id, user_id: userId },
        include: {
            collections: {
                include: {
                    collection: true,
                },
            },
        },
    });
    if (!citation) {
        return res.status(404).json({ success: false, error: 'Citation not found' });
    }
    return res.status(200).json({ success: true, data: citation });
}));
// ---------------------------------------------------------------------------
// POST /import — import from any provider
// ---------------------------------------------------------------------------
router.post('/import', hybridAuthMiddleware_js_1.authenticateHybridRequest, asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const { provider: providerRaw, projectId, items } = req.body ?? {};
    const provider = parseProvider(providerRaw);
    if (!provider) {
        return res.status(400).json({
            success: false,
            error: 'Invalid or missing provider. Must be one of: zotero, mendeley, manual, crossref',
        });
    }
    if (!projectId) {
        return res.status(400).json({ success: false, error: 'projectId is required' });
    }
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: 'items must be a non-empty array' });
    }
    // Verify the project belongs to the user
    const project = await prisma_js_1.prisma.project.findFirst({
        where: { id: String(projectId), user_id: userId },
    });
    if (!project) {
        return res.status(404).json({ success: false, error: 'Project not found' });
    }
    const results = [];
    const errors = [];
    for (let i = 0; i < items.length; i++) {
        const rawItem = items[i];
        try {
            let normalized;
            switch (provider) {
                case 'zotero':
                    normalized = (0, citationNormalizer_js_1.normalizeZoteroItem)(rawItem, userId);
                    break;
                case 'mendeley':
                    normalized = (0, citationNormalizer_js_1.normalizeMendeleyItem)(rawItem, userId);
                    break;
                case 'manual':
                case 'crossref':
                default:
                    normalized = (0, citationNormalizer_js_1.normalizeManualInput)(rawItem);
                    break;
            }
            // Persist to database
            const created = await prisma_js_1.prisma.citation.create({
                data: {
                    project_id: String(projectId),
                    user_id: userId,
                    title: normalized.title,
                    author: normalized.author,
                    authors: normalized.authors ?? undefined,
                    year: normalized.year ?? new Date().getFullYear(),
                    type: normalized.type ?? 'article-journal',
                    doi: normalized.doi,
                    url: normalized.url,
                    volume: normalized.volume,
                    issue: normalized.issue,
                    pages: normalized.pages,
                    publisher: normalized.publisher,
                    journal: normalized.journal,
                    abstract: normalized.abstract,
                    provider: normalized.provider,
                    providerId: normalized.providerId,
                    rawMetadata: normalized.rawMetadata ?? undefined,
                    identifiers: {
                        isbn: normalized.isbn,
                        issn: normalized.issn,
                        pmid: normalized.pmid,
                        pmcid: normalized.pmcid,
                        arxiv: normalized.arxiv,
                    },
                    attachments: normalized.attachments ?? undefined,
                    tags: normalized.tags ?? [],
                    isFavorite: normalized.isFavorite ?? false,
                    readingStatus: normalized.readingStatus ?? 'unread',
                    authenticityScore: normalized.authenticityScore ?? 0,
                    vault_verified: false,
                },
            });
            results.push(created);
        }
        catch (err) {
            errors.push({ index: i, message: err?.message ?? 'Unknown error' });
            logger_js_1.default.error(`[References API] Import error at index ${i}: ${err?.message}`);
        }
    }
    return res.status(errors.length === 0 ? 201 : 207).json({
        success: errors.length === 0,
        data: results,
        imported: results.length,
        failed: errors.length,
        errors: errors.length > 0 ? errors : undefined,
    });
}));
// ---------------------------------------------------------------------------
// POST /export — export back to provider
// ---------------------------------------------------------------------------
router.post('/export', hybridAuthMiddleware_js_1.authenticateHybridRequest, asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const { citationId, provider: providerRaw } = req.body ?? {};
    const provider = parseProvider(providerRaw);
    if (!provider) {
        return res.status(400).json({
            success: false,
            error: 'Invalid or missing provider. Must be one of: zotero, mendeley, manual, crossref',
        });
    }
    if (!citationId) {
        return res.status(400).json({ success: false, error: 'citationId is required' });
    }
    const citation = await prisma_js_1.prisma.citation.findFirst({
        where: { id: String(citationId), user_id: userId },
    });
    if (!citation) {
        return res.status(404).json({ success: false, error: 'Citation not found' });
    }
    // Export pushes the citation back to the original provider
    let result;
    switch (provider) {
        case 'zotero': {
            // Reconstruct Zotero item from rawMetadata or formatted fields
            const itemData = citation.rawMetadata || {
                itemType: citation.type || 'article-journal',
                title: citation.title,
                creators: citation.authors || [],
                date: citation.year?.toString() || '',
                DOI: citation.doi,
                url: citation.url,
                publicationTitle: citation.journal,
                volume: citation.volume,
                issue: citation.issue,
                pages: citation.pages,
                publisher: citation.publisher,
                abstractNote: citation.abstract,
            };
            // Get user's Zotero credentials
            const user = await prisma_js_1.prisma.user.findUnique({
                where: { id: userId },
                select: { zotero_user_id: true, zotero_api_key: true },
            });
            if (!user?.zotero_user_id || !user?.zotero_api_key) {
                return res.status(401).json({
                    success: false,
                    error: 'Zotero account not linked. Please reconnect.',
                });
            }
            const created = await zoteroService_js_1.ZoteroService.createItem(user.zotero_user_id, user.zotero_api_key, itemData);
            result = { zoteroItemKey: typeof created === 'string' ? created : created?.[0]?.key || 'unknown' };
            break;
        }
        case 'mendeley': {
            // Reconstruct Mendeley document from rawMetadata or formatted fields
            const documentData = citation.rawMetadata || {
                title: citation.title,
                type: citation.type || 'journal_article',
                authors: citation.authors || [],
                year: citation.year,
                doi: citation.doi,
                websites: citation.url ? [citation.url] : [],
                source: citation.journal,
                publisher: citation.publisher,
                volume: citation.volume,
                issue: citation.issue,
                pages: citation.pages,
                abstract: citation.abstract,
            };
            const created = await mendeleyService_js_1.MendeleyService.createDocument(userId, documentData);
            result = { mendeleyDocumentId: created?.id || 'unknown' };
            break;
        }
        case 'manual':
        case 'crossref':
        default:
            // For manual/crossref, return the normalized citation data
            result = {
                title: citation.title,
                author: citation.author,
                year: citation.year,
                type: citation.type,
                doi: citation.doi,
                url: citation.url,
                journal: citation.journal,
                volume: citation.volume,
                issue: citation.issue,
                pages: citation.pages,
                publisher: citation.publisher,
                abstract: citation.abstract,
            };
            break;
    }
    return res.status(200).json({
        success: true,
        data: result,
        message: `Exported citation to ${provider}`,
    });
}));
// ---------------------------------------------------------------------------
// PATCH /:id — update (isFavorite, tags, readingStatus)
// ---------------------------------------------------------------------------
router.patch('/:id', hybridAuthMiddleware_js_1.authenticateHybridRequest, asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const { id } = req.params;
    const { isFavorite, tags, readingStatus } = req.body ?? {};
    // Verify ownership
    const existing = await prisma_js_1.prisma.citation.findFirst({
        where: { id, user_id: userId },
    });
    if (!existing) {
        return res.status(404).json({ success: false, error: 'Citation not found' });
    }
    // Validate readingStatus if provided
    if (readingStatus !== undefined &&
        !['unread', 'reading', 'read'].includes(readingStatus)) {
        return res.status(400).json({
            success: false,
            error: 'readingStatus must be one of: unread, reading, read',
        });
    }
    const updateData = {};
    if (isFavorite !== undefined)
        updateData.isFavorite = Boolean(isFavorite);
    if (tags !== undefined)
        updateData.tags = Array.isArray(tags) ? tags : [];
    if (readingStatus !== undefined)
        updateData.readingStatus = readingStatus;
    if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ success: false, error: 'No valid fields to update' });
    }
    const updated = await prisma_js_1.prisma.citation.update({
        where: { id },
        data: updateData,
    });
    return res.status(200).json({ success: true, data: updated });
}));
// ---------------------------------------------------------------------------
// DELETE /:id
// ---------------------------------------------------------------------------
router.delete('/:id', hybridAuthMiddleware_js_1.authenticateHybridRequest, asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const { id } = req.params;
    const existing = await prisma_js_1.prisma.citation.findFirst({
        where: { id, user_id: userId },
    });
    if (!existing) {
        return res.status(404).json({ success: false, error: 'Citation not found' });
    }
    await prisma_js_1.prisma.citation.delete({ where: { id } });
    return res.status(200).json({ success: true, message: 'Citation deleted' });
}));
// ---------------------------------------------------------------------------
// GET /collections — list collections for project
// ---------------------------------------------------------------------------
router.get('/collections', hybridAuthMiddleware_js_1.authenticateHybridRequest, asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const { projectId } = req.query;
    if (!projectId) {
        return res.status(400).json({ success: false, error: 'projectId is required' });
    }
    const collections = await prisma_js_1.prisma.referenceCollection.findMany({
        where: { project_id: String(projectId), user_id: userId },
        orderBy: { sort_order: 'asc' },
        include: {
            _count: {
                select: { citations: true },
            },
        },
    });
    return res.status(200).json({ success: true, data: collections });
}));
// ---------------------------------------------------------------------------
// POST /collections — create collection
// ---------------------------------------------------------------------------
router.post('/collections', hybridAuthMiddleware_js_1.authenticateHybridRequest, asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const { projectId, name, description, type, color, icon } = req.body ?? {};
    if (!projectId) {
        return res.status(400).json({ success: false, error: 'projectId is required' });
    }
    if (!name || typeof name !== 'string') {
        return res.status(400).json({ success: false, error: 'name is required' });
    }
    // Verify project ownership
    const project = await prisma_js_1.prisma.project.findFirst({
        where: { id: String(projectId), user_id: userId },
    });
    if (!project) {
        return res.status(404).json({ success: false, error: 'Project not found' });
    }
    // Determine sort order (append to end)
    const lastCollection = await prisma_js_1.prisma.referenceCollection.findFirst({
        where: { project_id: String(projectId), user_id: userId },
        orderBy: { sort_order: 'desc' },
    });
    const collection = await prisma_js_1.prisma.referenceCollection.create({
        data: {
            project_id: String(projectId),
            user_id: userId,
            name,
            description: description ?? null,
            type: type ?? 'collection',
            color: color ?? null,
            icon: icon ?? null,
            sort_order: (lastCollection?.sort_order ?? 0) + 1,
        },
    });
    return res.status(201).json({ success: true, data: collection });
}));
// ---------------------------------------------------------------------------
// POST /collections/:collectionId/citations — add citation to collection
// ---------------------------------------------------------------------------
router.post('/collections/:collectionId/citations', hybridAuthMiddleware_js_1.authenticateHybridRequest, asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const { collectionId } = req.params;
    const { citationId } = req.body ?? {};
    if (!citationId) {
        return res.status(400).json({ success: false, error: 'citationId is required' });
    }
    // Verify collection ownership
    const collection = await prisma_js_1.prisma.referenceCollection.findFirst({
        where: { id: collectionId, user_id: userId },
    });
    if (!collection) {
        return res.status(404).json({ success: false, error: 'Collection not found' });
    }
    // Verify citation ownership
    const citation = await prisma_js_1.prisma.citation.findFirst({
        where: { id: String(citationId), user_id: userId },
    });
    if (!citation) {
        return res.status(404).json({ success: false, error: 'Citation not found' });
    }
    // Determine sort order (append to end)
    const lastEntry = await prisma_js_1.prisma.collectionCitation.findFirst({
        where: { collection_id: collectionId },
        orderBy: { sort_order: 'desc' },
    });
    try {
        const entry = await prisma_js_1.prisma.collectionCitation.create({
            data: {
                collection_id: collectionId,
                citation_id: String(citationId),
                sort_order: (lastEntry?.sort_order ?? 0) + 1,
            },
        });
        return res.status(201).json({ success: true, data: entry });
    }
    catch (err) {
        // Unique constraint violation means already in collection
        if (err?.code === 'P2002') {
            return res.status(409).json({
                success: false,
                error: 'Citation already in collection',
            });
        }
        throw err;
    }
}));
// ---------------------------------------------------------------------------
// DELETE /collections/:collectionId/citations/:citationId — remove from collection
// ---------------------------------------------------------------------------
router.delete('/collections/:collectionId/citations/:citationId', hybridAuthMiddleware_js_1.authenticateHybridRequest, asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const { collectionId, citationId } = req.params;
    // Verify collection ownership
    const collection = await prisma_js_1.prisma.referenceCollection.findFirst({
        where: { id: collectionId, user_id: userId },
    });
    if (!collection) {
        return res.status(404).json({ success: false, error: 'Collection not found' });
    }
    // Verify citation ownership
    const citation = await prisma_js_1.prisma.citation.findFirst({
        where: { id: citationId, user_id: userId },
    });
    if (!citation) {
        return res.status(404).json({ success: false, error: 'Citation not found' });
    }
    try {
        await prisma_js_1.prisma.collectionCitation.delete({
            where: {
                collection_id_citation_id: {
                    collection_id: collectionId,
                    citation_id: citationId,
                },
            },
        });
        return res.status(200).json({ success: true, message: 'Citation removed from collection' });
    }
    catch (err) {
        // Record not found
        if (err?.code === 'P2025') {
            return res.status(404).json({
                success: false,
                error: 'Citation not found in collection',
            });
        }
        throw err;
    }
}));
exports.default = router;
