import { prisma } from "../../lib/prisma";
import type { CanonicalDocument } from "../cdm";
import { tiptapToCdm } from "../cdm/tiptapImporter";

/**
 * CdmResolver — turns a stored DocumentVersion into a CanonicalDocument.
 *
 * Preference order:
 *   1. The persisted `cdm` snapshot (Phase 1 migration). Cheapest + canonical.
 *   2. Otherwise re-import from the TipTap `content` JSON (lossless fallback).
 *
 * Injected so workers are testable without a DB.
 */
export interface CdmResolver {
  resolve(docVersionId: string): Promise<CanonicalDocument>;
}

export class PrismaCdmResolver implements CdmResolver {
  async resolve(docVersionId: string): Promise<CanonicalDocument> {
    const version = await prisma.documentVersion.findUnique({
      where: { id: docVersionId },
    });
    if (!version) throw new Error(`DocumentVersion ${docVersionId} not found`);

    if (version.cdm) {
      return version.cdm as unknown as CanonicalDocument;
    }

    const content = version.content as unknown;
    if (!content) {
      throw new Error(`DocumentVersion ${docVersionId} has no content or cdm`);
    }
    return tiptapToCdm(content as any);
  }
}

export class InMemoryCdmResolver implements CdmResolver {
  constructor(
    private readonly versions: Map<string, CanonicalDocument | unknown>,
  ) {}

  static fromFixture(docVersionId: string, cdm: CanonicalDocument): CdmResolver {
    return new InMemoryCdmResolver(new Map([[docVersionId, cdm]]));
  }

  async resolve(docVersionId: string): Promise<CanonicalDocument> {
    const found = this.versions.get(docVersionId);
    if (!found) throw new Error(`DocumentVersion ${docVersionId} not found`);
    return found as CanonicalDocument;
  }
}

export function createCdmResolver(): CdmResolver {
  return new PrismaCdmResolver();
}
