import { initializePrisma } from "../lib/prisma-async";
import logger from "../monitoring/logger";

export interface AnnotationData {
    fileId: string;
    userId: string;
    content?: string;
    type: string; // 'highlight' | 'note'
    color?: string;
    coordinates: any;
}

export class AnnotationService {
    /**
     * Ensures a File record exists for the given ID (e.g., DOI/URL)
     */
    private static async ensureFileExists(fileId: string, userId: string) {
        const prisma = await initializePrisma();

        // Check if it already exists
        const existing = await prisma.file.findUnique({
            where: { id: fileId }
        });

        if (existing) return existing;

        // Create a "ghost" file record for a research paper
        // This allows us to link annotations to non-uploaded papers (URLs/DOIs)
        return await prisma.file.create({
            data: {
                id: fileId,
                user_id: userId,
                file_name: "Research Paper: " + fileId.substring(0, 30),
                file_path: "external://" + fileId,
                file_type: "application/pdf",
                file_size: 0,
                metadata: { source: "external_citation" }
            }
        });
    }

    /**
     * Get all annotations for a specific file
     */
    static async getFileAnnotations(fileId: string, userId: string) {
        try {
            // Ensure file entity exists so relations work
            await this.ensureFileExists(fileId, userId);

            const prisma = await initializePrisma();
            return await prisma.annotation.findMany({
                where: {
                    file_id: fileId,
                    user_id: userId,
                },
                orderBy: {
                    created_at: "asc",
                },
            });
        } catch (error: any) {
            logger.error("Error fetching annotations", { fileId, userId, error: error.message });
            throw error;
        }
    }

    /**
     * Create a new annotation
     */
    static async createAnnotation(data: AnnotationData) {
        try {
            // Ensure file entity exists so relations work
            await this.ensureFileExists(data.fileId, data.userId);

            const prisma = await initializePrisma();
            return await prisma.annotation.create({
                data: {
                    file_id: data.fileId,
                    user_id: data.userId,
                    content: data.content,
                    type: data.type,
                    color: data.color,
                    coordinates: data.coordinates,
                },
            });
        } catch (error: any) {
            logger.error("Error creating annotation", { data, error: error.message });
            throw error;
        }
    }

    /**
     * Update an existing annotation
     */
    static async updateAnnotation(id: string, userId: string, content?: string) {
        try {
            const prisma = await initializePrisma();
            return await prisma.annotation.update({
                where: {
                    id,
                    user_id: userId,
                },
                data: {
                    content,
                    updated_at: new Date(),
                },
            });
        } catch (error: any) {
            logger.error("Error updating annotation", { id, userId, error: error.message });
            throw error;
        }
    }

    /**
     * Delete an annotation
     */
    static async deleteAnnotation(id: string, userId: string) {
        try {
            const prisma = await initializePrisma();
            await prisma.annotation.delete({
                where: {
                    id,
                    user_id: userId,
                },
            });
            return true;
        } catch (error: any) {
            logger.error("Error deleting annotation", { id, userId, error: error.message });
            throw error;
        }
    }
}
