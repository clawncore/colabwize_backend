"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const annotationService_1 = require("../../services/annotationService");
const router = (0, express_1.Router)();
/**
 * @route GET /api/annotations/:fileId
 * @desc Get all annotations for a file
 */
router.get("/:fileId", async (req, res) => {
    try {
        const { fileId } = req.params;
        const userId = req.user.id;
        const annotations = await annotationService_1.AnnotationService.getFileAnnotations(fileId, userId);
        res.json({ success: true, data: annotations });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
/**
 * @route POST /api/annotations
 * @desc Create a new annotation
 */
router.post("/", async (req, res) => {
    try {
        const userId = req.user.id;
        const { fileId, content, type, color, coordinates } = req.body;
        if (!fileId || !type || !coordinates) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }
        const annotation = await annotationService_1.AnnotationService.createAnnotation({
            fileId,
            userId,
            content,
            type,
            color,
            coordinates,
        });
        res.status(201).json({ success: true, data: annotation });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
/**
 * @route PUT /api/annotations/:id
 * @desc Update an annotation's content
 */
router.put("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const { content } = req.body;
        const annotation = await annotationService_1.AnnotationService.updateAnnotation(id, userId, content);
        res.json({ success: true, data: annotation });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
/**
 * @route DELETE /api/annotations/:id
 * @desc Delete an annotation
 */
router.delete("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        await annotationService_1.AnnotationService.deleteAnnotation(id, userId);
        res.json({ success: true, message: "Annotation deleted" });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.default = router;
