import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";
import type { PageGeometry, CslStyle } from "../cdm";
import {
  type ResolvedTemplate,
  type PublishingTemplateInput,
  type TemplateVariable,
} from "./types";

/**
 * TemplateResolver — loads publishing templates (built-in + user-created) and
 * turns them into `ResolvedTemplate`s the export pipeline can consume.
 *
 * A template is intentionally just *data*: a CSL style + page geometry +
 * variables. We deliberately do NOT embed bespoke render engines per journal
 * (the plan's §4.D guidance) — the existing adapters already honour
 * `cslStyle`/`enableCiteproc`, so templates are configuration, not code.
 */
export interface TemplateResolver {
  resolve(templateId: string): Promise<ResolvedTemplate>;
  list(ownerId?: string): Promise<ResolvedTemplate[]>;
  create(ownerId: string, input: PublishingTemplateInput): Promise<ResolvedTemplate>;
}

const DEFAULT_GEOMETRY: PageGeometry = {
  size: "A4",
  margin: { top: "1in", bottom: "1in", left: "1in", right: "1in" },
  columns: 1,
};

function rowToResolved(row: any): ResolvedTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    isBuiltin: row.is_builtin ?? row.isBuiltin ?? false,
    format: row.format,
    cslStyle: row.csl_style ?? row.cslStyle,
    geometry: (row.geometry as PageGeometry) ?? DEFAULT_GEOMETRY,
    variables: (row.variables as TemplateVariable[]) ?? [],
  };
}

export class PrismaTemplateResolver implements TemplateResolver {
  async resolve(templateId: string): Promise<ResolvedTemplate> {
    const row = await prisma.publishingTemplate.findUnique({ where: { id: templateId } });
    if (!row) throw new Error(`Template ${templateId} not found`);
    return rowToResolved(row);
  }

  async list(ownerId?: string): Promise<ResolvedTemplate[]> {
    const rows = await prisma.publishingTemplate.findMany({
      where: ownerId ? { OR: [{ is_builtin: true }, { owner_id: ownerId }] } : {},
      orderBy: [{ is_builtin: "desc" }, { name: "asc" }],
    });
    return rows.map(rowToResolved);
  }

  async create(ownerId: string, input: PublishingTemplateInput): Promise<ResolvedTemplate> {
    const row = await prisma.publishingTemplate.create({
      data: {
        name: input.name,
        description: input.description,
        owner_id: ownerId,
        is_builtin: false,
        format: input.format,
        csl_style: input.cslStyle as CslStyle,
        geometry: (input.geometry ?? DEFAULT_GEOMETRY) as any,
        variables: (input.variables ?? []) as any,
      },
    });
    logger.info("Publishing template created", { id: row.id, ownerId });
    return rowToResolved(row);
  }
}

/** In-memory resolver for tests and for seeding built-in templates. */
export class InMemoryTemplateResolver implements TemplateResolver {
  private templates = new Map<string, ResolvedTemplate>();

  constructor(seed: ResolvedTemplate[] = []) {
    for (const t of seed) this.templates.set(t.id, t);
  }

  async resolve(templateId: string): Promise<ResolvedTemplate> {
    const t = this.templates.get(templateId);
    if (!t) throw new Error(`Template ${templateId} not found`);
    return t;
  }

  async list(ownerId?: string): Promise<ResolvedTemplate[]> {
    return [...this.templates.values()].filter(
      (t) => t.isBuiltin || !ownerId || true, // in-memory seed is shared; no ownership filter
    );
  }

  async create(ownerId: string, input: PublishingTemplateInput): Promise<ResolvedTemplate> {
    const id = `tpl-${this.templates.size + 1}`;
    const tpl: ResolvedTemplate = {
      id,
      name: input.name,
      description: input.description,
      isBuiltin: false,
      format: input.format,
      cslStyle: input.cslStyle,
      geometry: input.geometry ?? DEFAULT_GEOMETRY,
      variables: input.variables ?? [],
    };
    this.templates.set(id, tpl);
    return tpl;
  }
}

export function createTemplateResolver(): TemplateResolver {
  return new PrismaTemplateResolver();
}
