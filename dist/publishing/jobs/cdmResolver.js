"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryCdmResolver = exports.PrismaCdmResolver = void 0;
exports.createCdmResolver = createCdmResolver;
const prisma_1 = require("../../lib/prisma");
const tiptapImporter_1 = require("../cdm/tiptapImporter");
class PrismaCdmResolver {
    async resolve(docVersionId) {
        const version = await prisma_1.prisma.documentVersion.findUnique({
            where: { id: docVersionId },
        });
        if (!version)
            throw new Error(`DocumentVersion ${docVersionId} not found`);
        if (version.cdm) {
            return version.cdm;
        }
        const content = version.content;
        if (!content) {
            throw new Error(`DocumentVersion ${docVersionId} has no content or cdm`);
        }
        return (0, tiptapImporter_1.tiptapToCdm)(content);
    }
}
exports.PrismaCdmResolver = PrismaCdmResolver;
class InMemoryCdmResolver {
    versions;
    constructor(versions) {
        this.versions = versions;
    }
    static fromFixture(docVersionId, cdm) {
        return new InMemoryCdmResolver(new Map([[docVersionId, cdm]]));
    }
    async resolve(docVersionId) {
        const found = this.versions.get(docVersionId);
        if (!found)
            throw new Error(`DocumentVersion ${docVersionId} not found`);
        return found;
    }
}
exports.InMemoryCdmResolver = InMemoryCdmResolver;
function createCdmResolver() {
    return new PrismaCdmResolver();
}
