import express, { Request, Response } from 'express';
import { authenticateHybridRequest } from '../../middleware/hybridAuthMiddleware.js';
import { prisma } from '../../lib/prisma.js';
import logger from '../../monitoring/logger.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asyncHandler(
  fn: (req: Request, res: Response) => Promise<any>,
) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err: any) => {
      logger.error(`[Collections API] Unhandled error: ${err?.message}`, err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  };
}

function getUserId(req: Request): string {
  return (req as any).user?.id ?? '';
}

/**
 * Supported smart rule operators.
 * - "equals": exact match
 * - "contains": substring match (case-insensitive)
 * - "gte" / "lte": numeric comparison (year, etc.)
 * - "in": value is in a comma-separated list
 */
type SmartOperator = 'equals' | 'contains' | 'gte' | 'lte' | 'in';

interface SmartRule {
  field: string;
  operator: SmartOperator;
  value: string;
}

/**
 * Evaluate a single smart rule against a citation record.
 * Returns true if the citation matches the rule.
 */
function evaluateRule(rule: SmartRule, citation: Record<string, any>): boolean {
  const { field, operator, value } = rule;

  // Resolve the field value from the citation
  let fieldValue: any;
  if (field in citation) {
    fieldValue = citation[field];
  } else if (field === 'tags') {
    // tags is stored as JSON array
    fieldValue = citation.tags ?? [];
  } else if (field === 'provider') {
    fieldValue = citation.provider;
  } else if (field === 'isFavorite') {
    fieldValue = citation.isFavorite;
  } else if (field === 'year') {
    fieldValue = citation.year;
  } else {
    return false;
  }

  switch (operator) {
    case 'equals':
      return String(fieldValue).toLowerCase() === value.toLowerCase();

    case 'contains':
      if (Array.isArray(fieldValue)) {
        return fieldValue.some((v: any) =>
          String(v).toLowerCase().includes(value.toLowerCase()),
        );
      }
      return String(fieldValue).toLowerCase().includes(value.toLowerCase());

    case 'gte': {
      const numField = Number(fieldValue);
      const numValue = Number(value);
      if (Number.isNaN(numField) || Number.isNaN(numValue)) return false;
      return numField >= numValue;
    }

    case 'lte': {
      const numField = Number(fieldValue);
      const numValue = Number(value);
      if (Number.isNaN(numField) || Number.isNaN(numValue)) return false;
      return numField <= numValue;
    }

    case 'in': {
      const allowed = value.split(',').map((v) => v.trim().toLowerCase());
      if (Array.isArray(fieldValue)) {
        return fieldValue.some((v: any) =>
          allowed.includes(String(v).toLowerCase()),
        );
      }
      return allowed.includes(String(fieldValue).toLowerCase());
    }

    default:
      return false;
  }
}

/**
 * Evaluate all smart rules against a citation.
 * All rules must match (AND logic).
 */
function evaluateSmartRules(rules: SmartRule[], citation: Record<string, any>): boolean {
  if (!rules || rules.length === 0) return true;
  return rules.every((rule) => evaluateRule(rule, citation));
}

/**
 * Build a Prisma where clause from smart rules for database-level filtering.
 * Falls back to fetching all and filtering in memory for complex rules.
 */
function buildSmartRulesWhere(rules: SmartRule[]): Record<string, any> | null {
  const where: Record<string, any> = {};
  const unsupportedFields = new Set(['tags', 'isFavorite']);

  for (const rule of rules) {
    if (unsupportedFields.has(rule.field)) {
      // These require in-memory evaluation
      return null;
    }

    switch (rule.operator) {
      case 'equals':
        where[rule.field] = rule.value;
        break;
      case 'contains':
        where[rule.field] = { contains: rule.value, mode: 'insensitive' };
        break;
      case 'gte':
        where[rule.field] = { gte: Number(rule.value) };
        break;
      case 'lte':
        where[rule.field] = { lte: Number(rule.value) };
        break;
      case 'in':
        where[rule.field] = {
          in: rule.value.split(',').map((v) => v.trim()),
        };
        break;
    }
  }

  return Object.keys(where).length > 0 ? where : null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_OPERATORS: SmartOperator[] = ['equals', 'contains', 'gte', 'lte', 'in'];
const VALID_FIELDS = [
  'provider',
  'year',
  'type',
  'tags',
  'isFavorite',
  'readingStatus',
  'title',
  'author',
  'journal',
];

function validateRules(rules: any): { valid: boolean; error?: string; parsed?: SmartRule[] } {
  if (!Array.isArray(rules)) {
    return { valid: false, error: 'rules must be an array' };
  }

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (!rule || typeof rule !== 'object') {
      return { valid: false, error: `Rule at index ${i} must be an object` };
    }

    const { field, operator, value } = rule;
    if (typeof field !== 'string' || !VALID_FIELDS.includes(field)) {
      return {
        valid: false,
        error: `Rule at index ${i} has invalid field. Must be one of: ${VALID_FIELDS.join(', ')}`,
      };
    }
    if (typeof operator !== 'string' || !VALID_OPERATORS.includes(operator as SmartOperator)) {
      return {
        valid: false,
        error: `Rule at index ${i} has invalid operator. Must be one of: ${VALID_OPERATORS.join(', ')}`,
      };
    }
    if (typeof value !== 'string') {
      return { valid: false, error: `Rule at index ${i} must have a string value` };
    }
  }

  return { valid: true, parsed: rules as SmartRule[] };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const router = express.Router();

/**
 * POST /api/references/collections/:collectionId/smart-rules
 * Set or update smart rules for a collection.
 * The collection is marked as is_smart and citations are auto-populated.
 */
router.post(
  '/:collectionId/smart-rules',
  authenticateHybridRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const { collectionId } = req.params;
    const { rules } = req.body ?? {};

    // Validate rules
    const validation = validateRules(rules);
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error });
    }

    // Verify collection ownership
    const collection = await prisma.referenceCollection.findFirst({
      where: { id: collectionId, user_id: userId },
    });
    if (!collection) {
      return res.status(404).json({ success: false, error: 'Collection not found' });
    }

    // Update collection with smart rules
    const updated = await prisma.referenceCollection.update({
      where: { id: collectionId },
      data: {
        is_smart: true,
        smart_rules: rules as any,
      },
    });

    // Auto-populate: find matching citations and add them
    const projectId = collection.project_id;
    const parsedRules = validation.parsed!;

    // Try database-level filtering first
    const smartWhere = buildSmartRulesWhere(parsedRules);
    const baseWhere: Record<string, any> = {
      project_id: projectId,
      user_id: userId,
    };

    let matchingCitations: any[];

    if (smartWhere) {
      // We can filter at the DB level
      const candidates: any[] = await prisma.citation.findMany({
        where: { ...baseWhere, ...smartWhere },
      });

      // For rules that include unsupported fields, do additional in-memory filtering
      const hasUnsupportedRules = parsedRules.some(
        (r: any) => r.field === 'tags' || r.field === 'isFavorite',
      );

      if (hasUnsupportedRules) {
        matchingCitations = candidates.filter((c: any) =>
          evaluateSmartRules(parsedRules, c),
        );
      } else {
        matchingCitations = candidates;
      }
    } else {
      // Must fetch all and filter in memory
      const allCitations: any[] = await prisma.citation.findMany({ where: baseWhere });
      matchingCitations = allCitations.filter((c: any) =>
        evaluateSmartRules(parsedRules, c),
      );
    }

    // Get existing citation IDs in this collection
    const existingEntries = await prisma.collectionCitation.findMany({
      where: { collection_id: collectionId },
      select: { citation_id: true },
    });
    const existingIds = new Set(existingEntries.map((e: any) => e.citation_id));

    // Add new matching citations (skip already-present ones)
    const toAdd = matchingCitations.filter((c) => !existingIds.has(c.id));

    if (toAdd.length > 0) {
      // Determine starting sort order
      const maxOrder = existingEntries.length;

      await prisma.collectionCitation.createMany({
        data: toAdd.map((citation, index) => ({
          collection_id: collectionId,
          citation_id: citation.id,
          sort_order: maxOrder + index,
        })),
      });
    }

    logger.info(
      `[Collections API] Smart rules applied to collection ${collectionId}: ` +
      `${toAdd.length} citations added, ${matchingCitations.length} total matches`,
    );

    return res.status(200).json({
      success: true,
      data: {
        collection: updated,
        matchedCount: matchingCitations.length,
        addedCount: toAdd.length,
      },
      message: `Smart rules applied. ${toAdd.length} new citations added to collection.`,
    });
  }),
);

/**
 * DELETE /api/references/collections/:collectionId/smart-rules
 * Remove smart rules from a collection (converts it back to a regular collection).
 */
router.delete(
  '/:collectionId/smart-rules',
  authenticateHybridRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const { collectionId } = req.params;

    // Verify collection ownership
    const collection = await prisma.referenceCollection.findFirst({
      where: { id: collectionId, user_id: userId },
    });
    if (!collection) {
      return res.status(404).json({ success: false, error: 'Collection not found' });
    }

    const updated = await prisma.referenceCollection.update({
      where: { id: collectionId },
      data: {
        is_smart: false,
        smart_rules: null,
      },
    });

    return res.status(200).json({
      success: true,
      data: updated,
      message: 'Smart rules removed. Collection is now a regular collection.',
    });
  }),
);

/**
 * POST /api/references/collections/:collectionId/sync-smart
 * Re-evaluate smart rules and sync citations (manual trigger).
 */
router.post(
  '/:collectionId/sync-smart',
  authenticateHybridRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const { collectionId } = req.params;

    // Verify collection ownership and get rules
    const collection = await prisma.referenceCollection.findFirst({
      where: { id: collectionId, user_id: userId },
    });
    if (!collection) {
      return res.status(404).json({ success: false, error: 'Collection not found' });
    }

    if (!collection.is_smart || !collection.smart_rules) {
      return res.status(400).json({
        success: false,
        error: 'Collection is not a smart collection',
      });
    }

    const rules = collection.smart_rules as unknown as SmartRule[];
    const validation = validateRules(rules);
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error });
    }

    const parsedRules = validation.parsed!;
    const projectId = collection.project_id;

    // Find matching citations
    const smartWhere = buildSmartRulesWhere(parsedRules);
    const baseWhere: Record<string, any> = {
      project_id: projectId,
      user_id: userId,
    };

    let matchingCitations: any[];

    if (smartWhere) {
      const candidates: any[] = await prisma.citation.findMany({
        where: { ...baseWhere, ...smartWhere },
      });

      const hasUnsupportedRules = parsedRules.some(
        (r: any) => r.field === 'tags' || r.field === 'isFavorite',
      );

      if (hasUnsupportedRules) {
        matchingCitations = candidates.filter((c: any) =>
          evaluateSmartRules(parsedRules, c),
        );
      } else {
        matchingCitations = candidates;
      }
    } else {
      const allCitations: any[] = await prisma.citation.findMany({ where: baseWhere });
      matchingCitations = allCitations.filter((c: any) =>
        evaluateSmartRules(parsedRules, c),
      );
    }

    // Get existing entries
    const existingEntries = await prisma.collectionCitation.findMany({
      where: { collection_id: collectionId },
      select: { citation_id: true },
    });
    const existingIds = new Set(existingEntries.map((e: any) => e.citation_id));

    // Add new matches
    const toAdd = matchingCitations.filter((c: any) => !existingIds.has(c.id));

    // Remove citations that no longer match
    const matchingIds = new Set(matchingCitations.map((c: any) => c.id));
    const toRemove = existingEntries.filter(
      (e: any) => !matchingIds.has(e.citation_id),
    );

    // Perform additions
    if (toAdd.length > 0) {
      const maxOrder = existingEntries.length;
      await prisma.collectionCitation.createMany({
        data: toAdd.map((citation, index) => ({
          collection_id: collectionId,
          citation_id: citation.id,
          sort_order: maxOrder + index,
        })),
      });
    }

    // Perform removals
    if (toRemove.length > 0) {
      await prisma.collectionCitation.deleteMany({
        where: {
          collection_id: collectionId,
          citation_id: { in: toRemove.map((e: any) => e.citation_id) },
        },
      });
    }

    logger.info(
      `[Collections API] Smart collection ${collectionId} synced: ` +
      `${toAdd.length} added, ${toRemove.length} removed, ${matchingCitations.length} total matches`,
    );

    return res.status(200).json({
      success: true,
      data: {
        matchedCount: matchingCitations.length,
        addedCount: toAdd.length,
        removedCount: toRemove.length,
      },
      message: `Smart collection synced. ${toAdd.length} added, ${toRemove.length} removed.`,
    });
  }),
);

/**
 * GET /api/references/collections/:collectionId/smart-preview
 * Preview which citations would match the given rules (without modifying the collection).
 */
router.post(
  '/:collectionId/smart-preview',
  authenticateHybridRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const { collectionId } = req.params;
    const { rules } = req.body ?? {};

    // Validate rules
    const validation = validateRules(rules);
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error });
    }

    // Verify collection ownership to get project context
    const collection = await prisma.referenceCollection.findFirst({
      where: { id: collectionId, user_id: userId },
    });
    if (!collection) {
      return res.status(404).json({ success: false, error: 'Collection not found' });
    }

    const parsedRules = validation.parsed!;
    const projectId = collection.project_id;

    const smartWhere = buildSmartRulesWhere(parsedRules);
    const baseWhere: Record<string, any> = {
      project_id: projectId,
      user_id: userId,
    };

    let matchingCitations: any[];

    if (smartWhere) {
      const candidates: any[] = await prisma.citation.findMany({
        where: { ...baseWhere, ...smartWhere },
        select: {
          id: true,
          title: true,
          author: true,
          year: true,
          provider: true,
          type: true,
          tags: true,
          isFavorite: true,
          readingStatus: true,
        },
      });

      const hasUnsupportedRules = parsedRules.some(
        (r: any) => r.field === 'tags' || r.field === 'isFavorite',
      );

      if (hasUnsupportedRules) {
        matchingCitations = candidates.filter((c: any) =>
          evaluateSmartRules(parsedRules, c),
        );
      } else {
        matchingCitations = candidates;
      }
    } else {
      const allCitations: any[] = await prisma.citation.findMany({
        where: baseWhere,
        select: {
          id: true,
          title: true,
          author: true,
          year: true,
          provider: true,
          type: true,
          tags: true,
          isFavorite: true,
          readingStatus: true,
        },
      });
      matchingCitations = allCitations.filter((c: any) =>
        evaluateSmartRules(parsedRules, c),
      );
    }

    return res.status(200).json({
      success: true,
      data: {
        matchedCount: matchingCitations.length,
        citations: matchingCitations.slice(0, 50), // Cap preview at 50
      },
    });
  }),
);

export default router;
