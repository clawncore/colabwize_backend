import { Router, Request, Response } from "express";
import { AnnotationService } from "../../services/annotationService";
import logger from "../../monitoring/logger";

const router = Router();

interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
        email: string;
    };
}

/**
 * @route GET /api/annotations/:fileId
 * @desc Get all annotations for a file
 */
router.get("/:fileId", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { fileId } = req.params as any;
        const userId = req.user!.id;

        const annotations = await AnnotationService.getFileAnnotations(fileId, userId);
        res.json({ success: true, data: annotations });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @route POST /api/annotations
 * @desc Create a new annotation
 */
router.post("/", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const { fileId, content, type, color, coordinates } = req.body;

        if (!fileId || !type || !coordinates) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        const annotation = await AnnotationService.createAnnotation({
            fileId,
            userId,
            content,
            type,
            color,
            coordinates,
        });

        res.status(201).json({ success: true, data: annotation });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @route PUT /api/annotations/:id
 * @desc Update an annotation's content
 */
router.put("/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params as any;
        const userId = req.user!.id;
        const { content } = req.body;

        const annotation = await AnnotationService.updateAnnotation(id, userId, content);
        res.json({ success: true, data: annotation });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @route DELETE /api/annotations/:id
 * @desc Delete an annotation
 */
router.delete("/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params as any;
        const userId = req.user!.id;

        await AnnotationService.deleteAnnotation(id, userId);
        res.json({ success: true, message: "Annotation deleted" });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

export default router;
