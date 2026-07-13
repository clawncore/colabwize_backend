"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryTemplateResolver = exports.PrismaTemplateResolver = void 0;
exports.createTemplateResolver = createTemplateResolver;
const prisma_1 = require("../../lib/prisma");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const DEFAULT_GEOMETRY = {
    size: "A4",
    margin: { top: "1in", bottom: "1in", left: "1in", right: "1in" },
    columns: 1,
};
function rowToResolved(row) {
    return {
        id: row.id,
        name: row.name,
        description: row.description ?? undefined,
        isBuiltin: row.is_builtin ?? row.isBuiltin ?? false,
        format: row.format,
        cslStyle: row.csl_style ?? row.cslStyle,
        geometry: row.geometry ?? DEFAULT_GEOMETRY,
        variables: row.variables ?? [],
    };
}
class PrismaTemplateResolver {
    async resolve(templateId) {
        const row = await prisma_1.prisma.publishingTemplate.findUnique({ where: { id: templateId } });
        if (!row)
            throw new Error(`Template ${templateId} not found`);
        return rowToResolved(row);
    }
    async list(ownerId) {
        const rows = await prisma_1.prisma.publishingTemplate.findMany({
            where: ownerId ? { OR: [{ is_builtin: true }, { owner_id: ownerId }] } : {},
            orderBy: [{ is_builtin: "desc" }, { name: "asc" }],
        });
        return rows.map(rowToResolved);
    }
    async create(ownerId, input) {
        const row = await prisma_1.prisma.publishingTemplate.create({
            data: {
                name: input.name,
                description: input.description,
                owner_id: ownerId,
                is_builtin: false,
                format: input.format,
                csl_style: input.cslStyle,
                geometry: (input.geometry ?? DEFAULT_GEOMETRY),
                variables: (input.variables ?? []),
            },
        });
        logger_1.default.info("Publishing template created", { id: row.id, ownerId });
        return rowToResolved(row);
    }
}
exports.PrismaTemplateResolver = PrismaTemplateResolver;
/** In-memory resolver for tests and for seeding built-in templates. */
class InMemoryTemplateResolver {
    templates = new Map();
    constructor(seed = []) {
        for (const t of seed)
            this.templates.set(t.id, t);
    }
    async resolve(templateId) {
        const t = this.templates.get(templateId);
        if (!t)
            throw new Error(`Template ${templateId} not found`);
        return t;
    }
    async list(ownerId) {
        return [...this.templates.values()].filter((t) => t.isBuiltin || !ownerId || true);
    }
    async create(ownerId, input) {
        const id = `tpl-${this.templates.size + 1}`;
        const tpl = {
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
exports.InMemoryTemplateResolver = InMemoryTemplateResolver;
function createTemplateResolver() {
    return new PrismaTemplateResolver();
}
