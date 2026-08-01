"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EditorService = void 0;
exports.validateAndPrepareContent = validateAndPrepareContent;
const prisma_1 = require("../lib/prisma");
const logger_1 = __importDefault(require("../monitoring/logger"));
const subscriptionService_1 = require("./subscriptionService");
const notificationService_1 = require("./notificationService");
const BillingGateway_1 = require("../billing/BillingGateway");
const fileProcessor_1 = require("../utils/fileProcessor");
const workspaceActivityService_1 = require("./workspaceActivityService");
// Add a simple in-memory cache for version checking
const versionCheckCache = new Map();
const CACHE_DURATION = 30000; // 30 seconds cache
// Periodically clean up old cache entries to prevent memory leaks
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of versionCheckCache.entries()) {
        if (now - value.timestamp > CACHE_DURATION * 2) {
            versionCheckCache.delete(key);
        }
    }
}, 60000); // Run cleanup every minute
// Enhanced content validation function with improved Tiptap document structure validation
function validateAndPrepareContent(content) {
    // Handle null, undefined, or empty content
    if (content === null ||
        content === undefined ||
        (typeof content === "object" && Object.keys(content).length === 0)) {
        return {
            type: "doc",
            content: [{ type: "paragraph" }],
        };
    }
    // Handle string content (could be JSON string or plain text)
    if (typeof content === "string") {
        // If it looks like JSON, try to parse it
        if (content.trim().startsWith("{") || content.trim().startsWith("[")) {
            try {
                const parsed = JSON.parse(content);
                // If successfully parsed, validate the structure
                return validateAndPrepareContent(parsed);
            }
            catch (parseError) {
                // If parsing fails, treat as plain text
                return {
                    type: "doc",
                    content: [
                        {
                            type: "paragraph",
                            content: [{ type: "text", text: content }],
                        },
                    ],
                };
            }
        }
        else {
            // Plain text content
            return {
                type: "doc",
                content: [
                    {
                        type: "paragraph",
                        content: [{ type: "text", text: content }],
                    },
                ],
            };
        }
    }
    // Handle object content
    if (typeof content === "object" && !Array.isArray(content)) {
        // Check for valid Tiptap document structure
        if (content.type === "doc" && Array.isArray(content.content)) {
            // Process content to remove empty text nodes and invalid content
            const processedContent = [];
            for (const node of content.content) {
                // Skip null or undefined nodes
                if (node === null || node === undefined) {
                    continue;
                }
                // Handle paragraph nodes with content arrays
                if (node.type === "paragraph" && Array.isArray(node.content)) {
                    const validContent = node.content
                        .map((contentItem) => {
                        if (contentItem &&
                            typeof contentItem === "object" &&
                            contentItem.type === "text") {
                            // Handle text nodes
                            if (contentItem.text === undefined ||
                                contentItem.text === null) {
                                return null; // Remove invalid text nodes
                            }
                            const textValue = String(contentItem.text);
                            if (textValue.length === 0) {
                                return null; // Remove empty text nodes
                            }
                            return { ...contentItem, text: textValue };
                        }
                        else if (contentItem &&
                            typeof contentItem === "object" &&
                            contentItem.type) {
                            // Keep valid nodes with defined types
                            return contentItem;
                        }
                        else if (contentItem !== null && contentItem !== undefined) {
                            // Convert non-object items to text nodes
                            const stringValue = String(contentItem);
                            if (stringValue.length > 0) {
                                return { type: "text", text: stringValue };
                            }
                            return null; // Skip empty strings
                        }
                        return null; // Remove invalid items
                    })
                        .filter((contentItem) => contentItem !== null); // Remove any null items
                    if (validContent.length > 0) {
                        processedContent.push({
                            type: "paragraph",
                            content: validContent,
                        });
                    }
                    // Only add empty paragraph if it's the only content to prevent empty editor
                    else if (processedContent.length === 0 &&
                        content.content.length === 1) {
                        processedContent.push({ type: "paragraph" });
                    }
                    continue;
                }
                // Handle table-related nodes with special validation
                if (node.type === "table") {
                    const validatedTable = validateTableStructure(node);
                    if (validatedTable) {
                        processedContent.push(validatedTable);
                    }
                    continue;
                }
                // Handle tableRow nodes
                if (node.type === "tableRow") {
                    const validatedRow = validateTableRowStructure(node);
                    if (validatedRow) {
                        processedContent.push(validatedRow);
                    }
                    continue;
                }
                // Handle tableCell and tableHeader nodes
                if (node.type === "tableCell" || node.type === "tableHeader") {
                    const validatedCell = validateTableCellStructure(node);
                    if (validatedCell) {
                        processedContent.push(validatedCell);
                    }
                    continue;
                }
                // Handle known node types and validate their content
                if (node.type) {
                    // Convert "list-item" to "listItem" for compatibility with Tiptap schema
                    let processedNode = node;
                    if (node.type === "list-item") {
                        processedNode = { ...node, type: "listItem" };
                    }
                    // Handle visual-element nodes
                    if (node.type === "visual-element") {
                        processedNode = { ...node };
                    }
                    // Handle callout-block nodes
                    if (node.type === "callout-block") {
                        processedNode = { ...node };
                    }
                    // Handle cover-page nodes
                    if (node.type === "cover-page") {
                        processedNode = { ...node };
                    }
                    // Handle figure nodes
                    if (node.type === "figure") {
                        processedNode = { ...node };
                    }
                    // Handle section nodes
                    if (node.type === "section") {
                        processedNode = { ...node };
                    }
                    // Handle list nodes
                    if (node.type === "list") {
                        processedNode = { ...node };
                    }
                    // Handle action-list nodes
                    if (node.type === "action-list") {
                        processedNode = { ...node };
                    }
                    // Handle column nodes
                    if (node.type === "columns" || node.type === "columnItem") {
                        processedNode = { ...node };
                    }
                    // Handle pricing-table nodes
                    if (node.type === "pricing-table") {
                        processedNode = { ...node };
                    }
                    // Handle footnote nodes
                    if (node.type === "footnote" || node.type === "footnote-content") {
                        processedNode = { ...node };
                    }
                    // Handle citation nodes
                    if (node.type === "citation-block") {
                        processedNode = { ...node };
                    }
                    // Handle AI tag nodes
                    if (node.type === "ai-tag") {
                        processedNode = { ...node };
                    }
                    // Handle annotation nodes
                    if (node.type === "annotation-block") {
                        processedNode = { ...node };
                    }
                    // Handle author nodes
                    if (node.type === "author-block" || node.type === "author") {
                        processedNode = { ...node };
                    }
                    // Handle keywords nodes
                    if (node.type === "keywords") {
                        processedNode = { ...node };
                    }
                    // Handle quote-block nodes
                    if (node.type === "quote-block") {
                        processedNode = { ...node };
                    }
                    // Handle sidebar-block nodes
                    if (node.type === "sidebar-block") {
                        processedNode = { ...node };
                    }
                    // Handle caption nodes
                    if (node.type === "caption") {
                        processedNode = { ...node };
                    }
                    // Handle image-placeholder nodes
                    if (node.type === "image-placeholder") {
                        processedNode = { ...node };
                    }
                    // Handle presentation-deck nodes
                    if (node.type === "presentation-deck") {
                        processedNode = { ...node };
                    }
                    // Validate node content if it exists
                    if (Array.isArray(node.content)) {
                        const processedNodeContent = [];
                        for (const item of node.content) {
                            const processedItem = item;
                            if (typeof processedItem === "object" &&
                                processedItem.type === "text") {
                                // Handle text nodes
                                if (processedItem.text === undefined ||
                                    processedItem.text === null) {
                                    // Skip invalid text nodes
                                    continue;
                                }
                                const textValue = String(processedItem.text);
                                if (textValue.length === 0) {
                                    // Skip empty text nodes
                                    continue;
                                }
                                processedNodeContent.push({
                                    ...processedItem,
                                    text: textValue,
                                });
                            }
                            else if (typeof processedItem === "object" &&
                                processedItem.type) {
                                // Keep valid nodes with defined types
                                processedNodeContent.push(processedItem);
                            }
                            else if (processedItem !== null &&
                                processedItem !== undefined) {
                                // Convert non-object items to text nodes
                                const stringValue = String(processedItem);
                                if (stringValue.length > 0) {
                                    processedNodeContent.push({
                                        type: "text",
                                        text: stringValue,
                                    });
                                }
                            }
                            // Skip invalid items
                        }
                        if (processedNodeContent.length > 0 ||
                            !["text", "paragraph"].includes(node.type)) {
                            processedContent.push({
                                ...processedNode,
                                content: processedNodeContent,
                            });
                        }
                        else {
                            // Nodes without content or with non-array content are kept as-is
                            processedContent.push(processedNode);
                        }
                    }
                    else {
                        // Nodes without content or with non-array content are kept as-is
                        processedContent.push(processedNode);
                    }
                }
            }
            // Ensure we always have at least one paragraph to prevent empty content
            if (processedContent.length === 0) {
                processedContent.push({ type: "paragraph" });
            }
            // Ensure we have at least one paragraph to prevent empty content
            if (content.content.length === 0) {
                return {
                    ...content,
                    content: [{ type: "paragraph" }],
                };
            }
            return {
                ...content,
                content: processedContent,
            };
        }
        else {
            // Not a valid Tiptap document, convert to one
            return {
                type: "doc",
                content: [
                    {
                        type: "paragraph",
                        content: [{ type: "text", text: JSON.stringify(content) }],
                    },
                ],
            };
        }
    }
    // Handle array content
    if (Array.isArray(content)) {
        const processedContent = content.map((item) => {
            if (typeof item === "string") {
                return {
                    type: "paragraph",
                    content: [{ type: "text", text: item }],
                };
            }
            else if (typeof item === "object" && item !== null) {
                if (item.type) {
                    return item;
                }
                else {
                    return {
                        type: "paragraph",
                        content: [{ type: "text", text: JSON.stringify(item) }],
                    };
                }
            }
            else {
                return {
                    type: "paragraph",
                    content: [{ type: "text", text: String(item) }],
                };
            }
        });
        // Ensure we always have at least one paragraph to prevent empty content
        if (processedContent.length === 0) {
            processedContent.push({ type: "paragraph" });
        }
        return {
            type: "doc",
            content: processedContent,
        };
    }
    // Fallback for any other content type
    return {
        type: "doc",
        content: [
            {
                type: "paragraph",
                content: [{ type: "text", text: JSON.stringify(content) }],
            },
        ],
    };
}
// Helper function to validate table structure
function validateTableStructure(tableNode) {
    if (!tableNode || tableNode.type !== "table") {
        return null;
    }
    // Ensure table has content array
    if (!Array.isArray(tableNode.content)) {
        return {
            ...tableNode,
            content: [],
        };
    }
    // Validate each row in the table
    const validRows = tableNode.content
        .map((row) => validateTableRowStructure(row))
        .filter((row) => row !== null);
    // Only return table if it has valid rows
    if (validRows.length > 0) {
        return {
            ...tableNode,
            content: validRows,
        };
    }
    // Return null to skip invalid table
    return null;
}
// Helper function to validate table row structure
function validateTableRowStructure(rowNode) {
    if (!rowNode || rowNode.type !== "tableRow") {
        return null;
    }
    // Ensure row has content array
    if (!Array.isArray(rowNode.content)) {
        return {
            ...rowNode,
            content: [],
        };
    }
    // Validate each cell in the row
    const validCells = rowNode.content
        .map((cell) => validateTableCellStructure(cell))
        .filter((cell) => cell !== null);
    // Only return row if it has valid cells
    if (validCells.length > 0) {
        return {
            ...rowNode,
            content: validCells,
        };
    }
    // Return empty row if no valid cells
    return {
        ...rowNode,
        content: [],
    };
}
// Helper function to validate table cell structure
function validateTableCellStructure(cellNode) {
    if (!cellNode ||
        (cellNode.type !== "tableCell" && cellNode.type !== "tableHeader")) {
        return null;
    }
    // Ensure cell has content array or create empty one
    if (!Array.isArray(cellNode.content)) {
        return {
            ...cellNode,
            content: [{ type: "paragraph" }],
        };
    }
    // Validate content within cell
    const validContent = cellNode.content
        .map((item) => {
        if (item && typeof item === "object" && item.type === "text") {
            // Handle text nodes
            if (item.text === undefined || item.text === null) {
                return null;
            }
            const textValue = String(item.text);
            if (textValue.length === 0) {
                return null;
            }
            return { ...item, text: textValue };
        }
        else if (item && typeof item === "object" && item.type) {
            // Keep valid nodes
            return item;
        }
        else if (item !== null && item !== undefined) {
            // Convert to text node
            const stringValue = String(item);
            if (stringValue.length > 0) {
                return { type: "text", text: stringValue };
            }
        }
        return null;
    })
        .filter((item) => item !== null);
    // Ensure cell always has at least one paragraph
    if (validContent.length === 0) {
        return {
            ...cellNode,
            content: [{ type: "paragraph" }],
        };
    }
    return {
        ...cellNode,
        content: validContent,
    };
}
class EditorService {
    // Helper method to check if content is already a valid Tiptap document
    static isTiptapDocument(content) {
        return (content &&
            typeof content === "object" &&
            content.type === "doc" &&
            Array.isArray(content.content));
    }
    // Get project content
    static async getProjectContent(projectId, userId) {
        try {
            // Verify user has access to project
            const project = await prisma_1.prisma.project.findFirst({
                where: {
                    id: projectId,
                    user_id: userId,
                },
                select: {
                    id: true,
                    title: true,
                    content: true,
                    word_count: true,
                    updated_at: true,
                    citation_style: true,
                },
            });
            if (!project) {
                throw new Error("Project not found or access denied");
            }
            // Only validate content if it's not already a valid Tiptap document
            let validatedContent = project.content;
            if (!this.isTiptapDocument(project.content)) {
                validatedContent = validateAndPrepareContent(project.content);
            }
            // Track editor activity
            await this.trackEditorActivity(userId, projectId, "view", {
                projectId,
            });
            // Track editor event for analytics
            await this.trackEditorEvent(userId, projectId, "document_view", {
                projectId,
            });
            return {
                id: project.id,
                title: project.title,
                content: validatedContent,
                wordCount: project.word_count,
                lastUpdated: project.updated_at,
                citationStyle: project.citation_style,
            };
        }
        catch (error) {
            logger_1.default.error("Error fetching project content:", error);
            throw error;
        }
    }
    // Save project content
    static async saveProjectContent(projectId, userId, content, title, wordCount, 
    // Add a flag to indicate if this is a system operation (import, etc.) that shouldn't trigger activity tracking
    isSystemOperation = false) {
        try {
            // Check if user can create more documents based on subscription
            const canCreate = await this.checkDocumentLimit(userId);
            if (!canCreate) {
                throw new Error("Document limit reached for your subscription plan. Upgrade to create more documents.");
            }
            // Only validate content if it's not already a valid Tiptap document
            let validatedContent = content;
            if (!this.isTiptapDocument(content)) {
                validatedContent = validateAndPrepareContent(content);
            }
            // Log the content about to be saved for debugging
            if (validatedContent === null ||
                validatedContent === undefined ||
                (typeof validatedContent === "object" &&
                    !Array.isArray(validatedContent) &&
                    Object.prototype.hasOwnProperty.call(validatedContent, "content") &&
                    Array.isArray(validatedContent.content) &&
                    validatedContent.content.length === 0) ||
                (typeof validatedContent === "string" && validatedContent.trim() === "")) {
                console.warn(`[EditorService.saveProjectContent] WARNING: About to save empty or null content for projectId=${projectId}, userId=${userId}`);
            }
            else {
                console.log(`[EditorService.saveProjectContent] Saving content for projectId=${projectId}, userId=${userId}:`, JSON.stringify(validatedContent).slice(0, 500));
            }
            // Start a transaction to optimize database operations
            const result = await prisma_1.prisma.$transaction(async (tx) => {
                // Check if content has actually changed before updating
                const existingProject = await tx.project.findUnique({
                    where: { id: projectId },
                    select: {
                        content: true,
                        title: true,
                        word_count: true,
                        updated_at: true, // Include updated_at for optimistic locking
                    },
                });
                // Only update if content, title, or word count has changed substantially
                const existingContentStr = JSON.stringify(existingProject?.content);
                const newContentStr = JSON.stringify(validatedContent);
                const contentChanged = existingContentStr !== newContentStr;
                // Check for substantial content changes (more than 2000 characters difference to reduce false positives)
                // This prevents unnecessary saves for minor formatting changes while still catching real content updates
                const contentLengthDiff = Math.abs(existingContentStr?.length - newContentStr?.length);
                const substantialContentChange = contentLengthDiff > 0; // Changed from 50 to 0 to prevent data loss on small edits
                const titleChanged = title !== undefined && existingProject?.title !== title;
                const wordCountChanged = wordCount !== undefined && existingProject?.word_count !== wordCount;
                let updatedProject;
                // Only update for substantial changes or metadata changes
                if ((contentChanged && substantialContentChange) ||
                    titleChanged ||
                    wordCountChanged) {
                    try {
                        // Update project with new content using optimistic locking
                        updatedProject = await tx.project.update({
                            where: {
                                id: projectId,
                                user_id: userId,
                                updated_at: existingProject?.updated_at, // Optimistic locking condition using updated_at
                            },
                            data: {
                                content: contentChanged ? validatedContent : undefined,
                                title: titleChanged ? title : undefined,
                                word_count: wordCountChanged ? wordCount : undefined,
                                updated_at: new Date(),
                            },
                            select: {
                                id: true,
                                title: true,
                                content: true,
                                word_count: true,
                                updated_at: true,
                                citation_style: true,
                            },
                        });
                    }
                    catch (updateError) {
                        // Handle concurrency conflict - another save happened meanwhile
                        logger_1.default.warn("Concurrency conflict detected during save, fetching latest version", {
                            projectId,
                            userId,
                            error: updateError,
                        });
                        // Fetch the latest version to return current state
                        updatedProject = await tx.project.findUnique({
                            where: {
                                id: projectId,
                                user_id: userId,
                            },
                            select: {
                                id: true,
                                title: true,
                                content: true,
                                word_count: true,
                                updated_at: true,
                                citation_style: true,
                            },
                        });
                        // Add a flag to indicate this was a conflict resolution
                        if (updatedProject) {
                            updatedProject._conflictResolved = true;
                        }
                    }
                    // Only track editor activity for genuine user interactions, not system operations
                    if (!isSystemOperation) {
                        // Track editor activity (batch this operation)
                        setImmediate(async () => {
                            try {
                                await prisma_1.prisma.$transaction(async (tx) => {
                                    // Track editor activity (batch this operation)
                                    await this.trackEditorActivity(userId, projectId, "save", {
                                        projectId,
                                        contentChanged,
                                        titleChanged,
                                        wordCountChanged,
                                    }, tx);
                                    // Track editor event for analytics
                                    await this.trackEditorEvent(userId, projectId, "document_save", {
                                        contentChanged,
                                        titleChanged,
                                        wordCountChanged,
                                        wordCount: wordCount || existingProject?.word_count || 0,
                                    });
                                });
                            }
                            catch (activityError) {
                                logger_1.default.error("Error tracking editor activity", {
                                    error: activityError,
                                    projectId,
                                    userId,
                                });
                            }
                        });
                    }
                }
                else {
                    // No substantial changes, return existing project data
                    updatedProject = existingProject;
                    updatedProject.id = projectId; // Add the id since it's not in the select
                }
                return updatedProject;
            });
            // Return the result with a flag indicating if it was a conflict resolution
            return {
                ...(result || {}),
                _conflictResolved: result?._conflictResolved || false,
            };
        }
        catch (error) {
            logger_1.default.error("Error saving project content", {
                error,
                projectId,
                userId,
            });
            throw error;
        }
    }
    // Track editor activity for analytics and billing
    static async trackEditorActivity(userId, projectId, action, metadata, tx) {
        try {
            const prismaClient = tx || prisma_1.prisma;
            // Validate that the project exists if projectId is provided and not a temporary ID
            let validatedProjectId = projectId;
            if (projectId && projectId !== "temp-project-id") {
                const projectExists = await prismaClient.project.findUnique({
                    where: { id: projectId },
                    select: { id: true },
                });
                // If project doesn't exist, set projectId to null to avoid foreign key constraint violation
                if (!projectExists) {
                    validatedProjectId = null;
                }
            }
            else if (projectId === "temp-project-id") {
                // For temporary projects, set projectId to null to avoid foreign key constraint violation
                validatedProjectId = null;
            }
            // Create activity record
            await prismaClient.editorActivity.create({
                data: {
                    user_id: userId,
                    project_id: validatedProjectId,
                    activity_type: action,
                    details: metadata,
                },
            });
            // Update user's last active timestamp
            await prismaClient.userCollaborationSettings.upsert({
                where: { user_id: userId },
                update: { last_active: new Date() },
                create: {
                    user_id: userId,
                    last_active: new Date(),
                },
            });
            // For "save" actions, increment the daily save counter for billing purposes
            if (action === "save") {
                const today = new Date().toISOString().split("T")[0];
                await prismaClient.dailySaveCounter.upsert({
                    where: {
                        user_id_date: {
                            user_id: userId,
                            date: today,
                        },
                    },
                    update: {
                        count: { increment: 1 },
                    },
                    create: {
                        user_id: userId,
                        date: today,
                        count: 1,
                    },
                });
            }
        }
        catch (error) {
            // Don't throw error for activity tracking as it shouldn't block the main operation
            logger_1.default.warn("Failed to track editor activity", {
                error,
                userId,
                projectId,
            });
        }
    }
    // Track editor events for analytics
    static async trackEditorEvent(userId, projectId, eventType, metadata = {}, 
    // Add a flag to indicate if this is a system operation (import, etc.) that shouldn't trigger activity tracking
    isSystemOperation = false) {
        // Only track editor events for genuine user interactions, not system operations
        if (isSystemOperation) {
            return;
        }
        try {
            // Validate that the project exists if projectId is provided
            if (projectId) {
                const projectExists = await prisma_1.prisma.project.findUnique({
                    where: { id: projectId },
                    select: { id: true },
                });
                // If project doesn't exist, set projectId to null to avoid foreign key constraint violation
                if (!projectExists) {
                    projectId = null;
                }
            }
            await prisma_1.prisma.editorEvent.create({
                data: {
                    user_id: userId,
                    project_id: projectId,
                    event_type: eventType,
                    metadata: metadata,
                    created_at: new Date(),
                },
            });
        }
        catch (error) {
            logger_1.default.error("Error tracking editor event", {
                error,
                userId,
                projectId,
                eventType,
            });
        }
    }
    // Update project metadata
    static async updateProjectMetadata(projectId, userId, metadata) {
        try {
            // First check if the project belongs to the user
            const project = await prisma_1.prisma.project.findFirst({
                where: {
                    id: projectId,
                    user_id: userId,
                },
            });
            if (!project) {
                throw new Error("Project not found or unauthorized");
            }
            // Update the project with the provided metadata
            const updatedProject = await prisma_1.prisma.project.update({
                where: {
                    id: projectId,
                },
                data: {
                    ...(metadata.title !== undefined && { title: metadata.title }),
                    ...(metadata.wordCount !== undefined && {
                        word_count: metadata.wordCount,
                    }),
                    ...(metadata.citationStyle !== undefined && {
                        citation_style: metadata.citationStyle,
                    }),
                    updated_at: new Date(),
                },
            });
            return updatedProject;
        }
        catch (error) {
            logger_1.default.error("Error updating project metadata:", {
                error,
                projectId,
                userId,
                metadata,
            });
            throw error;
        }
    }
    // Add a comment to a document
    static async addComment(projectId, userId, content, position) {
        try {
            // First check if the project belongs to the user or if user is a collaborator
            const project = await prisma_1.prisma.project.findFirst({
                where: {
                    id: projectId,
                    OR: [
                        { user_id: userId },
                        { collaborators: { some: { user_id: userId } } },
                    ],
                },
            });
            if (!project) {
                throw new Error("Project not found or unauthorized");
            }
            // Create the comment
            const comment = await prisma_1.prisma.comment.create({
                data: {
                    project_id: projectId,
                    user_id: userId,
                    content: content,
                    position: position,
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            avatar_url: true,
                        },
                    },
                },
            });
            return comment;
        }
        catch (error) {
            logger_1.default.error("Error adding comment:", {
                error,
                projectId,
                userId,
                content,
            });
            throw error;
        }
    }
    // Get comments for a document
    static async getComments(projectId, userId) {
        try {
            // First check if the project belongs to the user or if user is a collaborator
            const project = await prisma_1.prisma.project.findFirst({
                where: {
                    id: projectId,
                    OR: [
                        { user_id: userId },
                        { collaborators: { some: { user_id: userId } } },
                    ],
                },
            });
            if (!project) {
                throw new Error("Project not found or unauthorized");
            }
            // Get all comments for the project
            const comments = await prisma_1.prisma.comment.findMany({
                where: {
                    project_id: projectId,
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            avatar_url: true,
                        },
                    },
                },
                orderBy: {
                    created_at: "asc",
                },
            });
            return comments;
        }
        catch (error) {
            logger_1.default.error("Error getting comments:", {
                error,
                projectId,
                userId,
            });
            throw error;
        }
    }
    // Get editor settings for a user
    static async getEditorSettings(userId) {
        try {
            // Try to find existing settings
            let settings = await prisma_1.prisma.editorSettings.findUnique({
                where: {
                    user_id: userId,
                },
            });
            // If no settings exist, create default settings
            if (!settings) {
                settings = await prisma_1.prisma.editorSettings.create({
                    data: {
                        user_id: userId,
                    },
                });
            }
            return settings;
        }
        catch (error) {
            logger_1.default.error("Error getting editor settings:", {
                error,
                userId,
            });
            throw error;
        }
    }
    // Convert camelCase keys to snake_case for Prisma
    // Only include fields that exist in the EditorSettings model
    static convertToSnakeCase(obj) {
        const converted = {};
        // Define the allowed fields that exist in the database model
        const allowedFields = {
            fontFamily: "font_family",
            fontSize: "font_size",
            lineHeight: "line_height",
            lineWidth: "line_width",
            accentColor: "accent_color",
            sidebarPosition: "sidebar_position",
            density: "density",
            autoDarkMode: "auto_dark_mode",
            darkModeStartTime: "dark_mode_start_time",
            darkModeEndTime: "dark_mode_end_time",
            pageColor: "page_color",
        };
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                // Only convert and include allowed fields
                if (allowedFields[key]) {
                    converted[allowedFields[key]] = obj[key];
                }
            }
        }
        return converted;
    }
    // Update editor settings for a user
    static async updateEditorSettings(userId, settingsData) {
        try {
            // Convert camelCase field names to snake_case for Prisma
            const prismaSettingsData = this.convertToSnakeCase(settingsData);
            // Update or create settings
            const settings = await prisma_1.prisma.editorSettings.upsert({
                where: {
                    user_id: userId,
                },
                update: {
                    ...prismaSettingsData,
                    updated_at: new Date(),
                },
                create: {
                    user_id: userId,
                    ...prismaSettingsData,
                },
            });
            return settings;
        }
        catch (error) {
            logger_1.default.error("Error updating editor settings:", {
                error,
                userId,
                settingsData,
            });
            throw error;
        }
    }
    // Import a document
    static async importDocument(userId, fileData) {
        // Reserve quota through the single billing pipeline (hold → execute →
        // confirm). checkActionEligibility was a dry-run gate that did not
        // consume; the gateway does both atomically. Declared at method scope so
        // it is reachable by both the success-confirm and the failure-release
        // paths.
        let billingEventId = null;
        try {
            const hold = await BillingGateway_1.BillingGateway.hold(userId, "create_project");
            billingEventId = hold.eventId;
        }
        catch (billingError) {
            throw new Error(billingError.message || "You cannot create a project at this time.");
        }
        try {
            // Process the file content through the file processor
            const { content: processedContent, wordCount: calculatedWordCount } = await (0, fileProcessor_1.processFileContent)(fileData.content, fileData.fileType);
            // Create project data with a default title if none provided
            const projectTitle = fileData.title || "Untitled Document";
            const projectData = {
                title: projectTitle,
                type: "document",
                citation_style: "apa", // Default citation style
                content: processedContent,
                word_count: fileData.wordCount || calculatedWordCount,
            };
            // Create the project directly using prisma
            const project = await prisma_1.prisma.project.create({
                data: {
                    user_id: userId,
                    title: projectData.title,
                    description: "", // Default empty description
                    content: projectData.content,
                    word_count: projectData.word_count,
                    citation_style: projectData.citation_style,
                    type: projectData.type || "research-paper",
                    status: "active", // Default status
                },
                include: {
                    user: true,
                    collaborators: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    email: true,
                                    full_name: true,
                                },
                            },
                        },
                    },
                },
            });
            // Create initial document version for the imported document
            if (project) {
                try {
                    await this.createDocumentVersion(project.id, userId, processedContent, fileData.wordCount || calculatedWordCount || 0);
                }
                catch (versionError) {
                    logger_1.default.warn("Failed to create initial document version for import", {
                        error: versionError,
                        projectId: project.id,
                        userId,
                    });
                    // Don't fail the import if version creation fails
                }
            }
            // Track the import as a system operation (don't create editor activity entries)
            await this.trackEditorEvent(userId, project.id, "document_import", {
                fileType: fileData.fileType,
                fileSize: JSON.stringify(fileData.content).length,
            }, true); // Mark as system operation
            // Confirm the pre-acquired hold now that the project is created.
            if (billingEventId) {
                await BillingGateway_1.BillingGateway.confirm(billingEventId);
            }
            return project;
        }
        catch (error) {
            // Release the hold on any failure so the user isn't charged for an
            // import that didn't complete.
            if (billingEventId) {
                await BillingGateway_1.BillingGateway.release(billingEventId, error.message);
            }
            logger_1.default.error("Error importing document:", {
                error,
                userId,
                fileData,
            });
            throw error;
        }
    }
    // Track typing patterns
    static async trackTypingPattern(userId, projectId, patternData) {
        await this.trackEditorEvent(userId, projectId, "typing_pattern", patternData);
    }
    // Track feature interactions
    static async trackFeatureInteraction(userId, projectId, featureName, interactionData = {}) {
        await this.trackEditorEvent(userId, projectId, "feature_interaction", {
            featureName,
            ...interactionData,
        });
    }
    // Track command usage
    static async trackCommandUsage(userId, projectId, commandName, usageData = {}) {
        await this.trackEditorEvent(userId, projectId, "command_usage", {
            commandName,
            ...usageData,
        });
    }
    // Check if user can create more documents based on subscription
    static async checkDocumentLimit(userId) {
        try {
            // Generate a cache key for this check
            const cacheKey = `${userId}_document_limit`;
            const cachedResult = versionCheckCache.get(cacheKey);
            // Check if we have a fresh cached result
            if (cachedResult &&
                Date.now() - cachedResult.timestamp < CACHE_DURATION) {
                return cachedResult.shouldCreate;
            }
            // Get user's subscription
            const subscription = await subscriptionService_1.SubscriptionService.getUserSubscription(userId);
            const planId = await subscriptionService_1.SubscriptionService.getActivePlan(userId, subscription);
            // For free tier users, check document count
            if (planId === "free") {
                const documentCount = await prisma_1.prisma.project.count({
                    where: { user_id: userId },
                });
                const canCreate = documentCount < 5; // Free tier limit
                // Cache the result
                versionCheckCache.set(cacheKey, {
                    timestamp: Date.now(),
                    shouldCreate: canCreate,
                });
                if (!canCreate) {
                    // Send notification to user about reaching limit
                    await (0, notificationService_1.createNotification)(userId, "ai_limit", "You've reached your document limit. Upgrade to create more documents.", "/pricing");
                }
                return canCreate;
            }
            // For paid tiers, allow creation
            // Cache the result
            versionCheckCache.set(cacheKey, {
                timestamp: Date.now(),
                shouldCreate: true,
            });
            return true;
        }
        catch (error) {
            logger_1.default.error("Error checking document limit", { error, userId });
            // Fail gracefully by allowing creation
            return true;
        }
    }
    // Get document statistics
    static async getDocumentStats(projectId, userId) {
        try {
            const project = await prisma_1.prisma.project.findFirst({
                where: {
                    id: projectId,
                    user_id: userId,
                },
                select: {
                    word_count: true,
                    character_count: true,
                    paragraph_count: true,
                    last_updated: true,
                },
            });
            if (!project) {
                throw new Error("Project not found or access denied");
            }
            return {
                wordCount: project.word_count || 0,
                characterCount: project.character_count || 0,
                paragraphCount: project.paragraph_count || 0,
                lastUpdated: project.last_updated,
            };
        }
        catch (error) {
            logger_1.default.error("Error fetching document stats", {
                error,
                projectId,
                userId,
            });
            throw error;
        }
    }
    // Process uploaded file content
    static async processUploadedContent(projectId, userId, fileData) {
        try {
            // Process the file content
            const processedContent = await (0, fileProcessor_1.processFileContent)(fileData.data, fileData.type);
            // Validate and prepare the content
            const validatedContent = validateAndPrepareContent(processedContent);
            // Save the processed content
            const result = await this.saveProjectContent(projectId, userId, validatedContent);
            // Track file processing activity
            await this.trackEditorActivity(userId, projectId, "file_upload", {
                fileType: fileData.type,
                fileSize: fileData.size,
            });
            return result;
        }
        catch (error) {
            logger_1.default.error("Error processing uploaded content", {
                error,
                projectId,
                userId,
            });
            throw error;
        }
    }
    // Get editor analytics for a user
    static async getEditorActivity(userId) {
        try {
            // Get aggregated editor activity data
            const activityData = await prisma_1.prisma.editorActivity.groupBy({
                by: ["activity_type"],
                where: {
                    user_id: userId,
                    timestamp: {
                        gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
                    },
                },
                _count: {
                    activity_type: true,
                },
            });
            // Get recent document statistics
            const recentDocuments = await prisma_1.prisma.project.findMany({
                where: {
                    user_id: userId,
                    updated_at: {
                        gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
                    },
                },
                select: {
                    id: true,
                    title: true,
                    word_count: true,
                    updated_at: true,
                },
                orderBy: {
                    updated_at: "desc",
                },
                take: 10,
            });
            // Calculate total words written
            const totalWords = recentDocuments.reduce((sum, doc) => sum + (doc.word_count || 0), 0);
            // Get typing patterns from editor events
            const typingEvents = await prisma_1.prisma.editorEvent.findMany({
                where: {
                    user_id: userId,
                    event_type: "typing_pattern",
                    created_at: {
                        gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
                    },
                },
                orderBy: {
                    created_at: "desc",
                },
                take: 50,
            });
            // Aggregate typing patterns
            const typingPatterns = typingEvents.map((event) => event.metadata || {});
            // Get feature usage
            const featureEvents = await prisma_1.prisma.editorEvent.findMany({
                where: {
                    user_id: userId,
                    event_type: "feature_interaction",
                    created_at: {
                        gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
                    },
                },
            });
            // Aggregate feature usage
            const featureUsage = {};
            featureEvents.forEach((event) => {
                const featureName = event.metadata?.featureName || "unknown";
                featureUsage[featureName] = (featureUsage[featureName] || 0) + 1;
            });
            // Get command usage
            const commandEvents = await prisma_1.prisma.editorEvent.findMany({
                where: {
                    user_id: userId,
                    event_type: "command_usage",
                    created_at: {
                        gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
                    },
                },
            });
            // Aggregate command usage
            const commandUsage = {};
            commandEvents.forEach((event) => {
                const commandName = event.metadata?.commandName || "unknown";
                commandUsage[commandName] = (commandUsage[commandName] || 0) + 1;
            });
            return {
                userId,
                totalWords,
                totalDocuments: recentDocuments.length,
                recentDocuments,
                typingPatterns,
                featureUsage,
                commandUsage,
                activityData: activityData.map((item) => ({
                    action: item.activity_type,
                    count: item._count.activity_type,
                })),
            };
        }
        catch (error) {
            logger_1.default.error("Error fetching editor analytics", { error, userId });
            throw error;
        }
    }
    // Add the missing shouldCreateNewVersion method
    static async shouldCreateNewVersion(projectId, tx, wordCount, content) {
        try {
            const prismaClient = tx || prisma_1.prisma;
            // Get the latest version for this project
            const latestVersion = await prismaClient.documentVersion.findFirst({
                where: { project_id: projectId },
                orderBy: { created_at: "desc" },
            });
            // If no previous version exists, create one
            if (!latestVersion) {
                return true;
            }
            // Dual-threshold approach:
            // 1. Time-based threshold: Create new version if more than 1 hour has passed
            const timeThreshold = 60 * 60 * 1000; // 1 hour in milliseconds
            const timeSinceLastVersion = Date.now() - new Date(latestVersion.created_at).getTime();
            // 2. Content change threshold: Create new version if significant content changes
            let contentChangedSignificantly = false;
            let contentChangedAtAll = false;
            if (content && latestVersion.content) {
                const currentContentStr = JSON.stringify(content);
                const previousContentStr = JSON.stringify(latestVersion.content);
                // Check if there is ANY change
                contentChangedAtAll = currentContentStr !== previousContentStr;
                // Calculate Levenshtein distance for content difference if there is a change
                // AND strings aren't too large (avoid O(N^2) on documents > 20k characters to prevent timeouts)
                if (contentChangedAtAll) {
                    const maxLength = Math.max(previousContentStr.length, currentContentStr.length);
                    if (maxLength > 20000) {
                        // For very large documents, use a simpler heuristic (length difference)
                        // If length changed by more than 500 characters, consider it significant
                        const lengthDiff = Math.abs(previousContentStr.length - currentContentStr.length);
                        contentChangedSignificantly = lengthDiff > 500;
                        logger_1.default.info("Large document detected, using length-based change detection", {
                            projectId,
                            maxLength,
                            lengthDiff
                        });
                    }
                    else {
                        const distance = this.calculateLevenshteinDistance(previousContentStr, currentContentStr);
                        // If more than 10% of content has changed, consider it significant
                        if (maxLength > 0) {
                            const changePercentage = (distance / maxLength) * 100;
                            contentChangedSignificantly = changePercentage > 10;
                        }
                    }
                }
            }
            // 3. Word count threshold: Create new version if word count increased by 200+
            let wordCountIncreasedSignificantly = false;
            if (wordCount !== undefined && latestVersion.word_count !== null) {
                const wordCountDifference = Math.abs(wordCount - latestVersion.word_count);
                wordCountIncreasedSignificantly = wordCountDifference >= 200;
            }
            // Create new version if:
            // - Significant content or word count changes detected
            // - OR 1 hour has passed AND there is AT LEAST some change
            return (contentChangedSignificantly ||
                wordCountIncreasedSignificantly ||
                (timeSinceLastVersion > timeThreshold && contentChangedAtAll));
        }
        catch (error) {
            logger_1.default.error("Error determining if new version should be created:", error);
            // Fail gracefully by allowing version creation
            return true;
        }
    }
    // Helper method to calculate Levenshtein distance between two strings
    // Optimized for memory usage (O(min(M, N)) space)
    static calculateLevenshteinDistance(str1, str2) {
        if (str1.length < str2.length)
            [str1, str2] = [str2, str1];
        if (str2.length === 0)
            return str1.length;
        let prevRow = Array.from({ length: str2.length + 1 }, (_, i) => i);
        for (let i = 0; i < str1.length; i++) {
            let currRow = [i + 1];
            for (let j = 0; j < str2.length; j++) {
                const insertions = prevRow[j + 1] + 1;
                const deletions = currRow[j] + 1;
                const substitutions = prevRow[j] + (str1[i] === str2[j] ? 0 : 1);
                currRow.push(Math.min(insertions, deletions, substitutions));
            }
            prevRow = currRow;
        }
        return prevRow[str2.length];
    }
    // Add the missing createDocumentVersion method
    static async createDocumentVersion(projectId, userId, content, wordCount, tx) {
        try {
            const prismaClient = tx || prisma_1.prisma;
            // Get the project to ensure it exists and belongs to the user
            const project = await prismaClient.project.findUnique({
                where: { id: projectId },
            });
            if (!project) {
                throw new Error("Project not found");
            }
            // Get the latest version number for this project
            const latestVersion = await prismaClient.documentVersion.findFirst({
                where: { project_id: projectId },
                orderBy: { version: "desc" },
            });
            const nextVersionNumber = latestVersion ? latestVersion.version + 1 : 1;
            // Create the new document version
            const documentVersion = await prismaClient.documentVersion.create({
                data: {
                    project_id: projectId,
                    user_id: userId,
                    content: content,
                    version: nextVersionNumber,
                    word_count: wordCount,
                },
            });
            // Track the version creation event
            await this.trackEditorEvent(userId, projectId, "document_version_created", {
                versionNumber: nextVersionNumber,
                wordCount: wordCount,
            });
            // Log workspace activity if it's part of a workspace
            if (project.workspace_id) {
                try {
                    await workspaceActivityService_1.WorkspaceActivityService.logActivity(project.workspace_id, userId, "VERSION_SAVED", {
                        projectId,
                        projectTitle: project.title,
                        version: nextVersionNumber,
                    });
                }
                catch (logError) {
                    logger_1.default.error("Failed to log version creation activity:", logError);
                }
            }
            return {
                id: documentVersion.id,
                version: documentVersion.version,
                created_at: documentVersion.created_at,
            };
        }
        catch (error) {
            logger_1.default.error("Error creating document version:", error);
            throw error;
        }
    }
    // Add the missing getDocumentVersions method
    static async getDocumentVersions(projectId, userId) {
        try {
            // Verify user has access to project
            const project = await prisma_1.prisma.project.findFirst({
                where: {
                    id: projectId,
                    OR: [
                        { user_id: userId },
                        { collaborators: { some: { user_id: userId } } },
                        {
                            workspace: {
                                members: { some: { user_id: userId } },
                            },
                        },
                    ],
                },
            });
            if (!project) {
                throw new Error("Project not found or access denied");
            }
            // Get all versions for this project ordered by version number descending
            const versions = await prisma_1.prisma.documentVersion.findMany({
                where: { project_id: projectId },
                orderBy: { version: "desc" },
                select: {
                    id: true,
                    version: true,
                    created_at: true,
                    word_count: true,
                    user_id: true,
                    user: {
                        select: {
                            id: true,
                            full_name: true,
                            email: true,
                        },
                    },
                },
            });
            // Transform the data to match expected frontend format
            return versions.map((version) => ({
                id: version.id,
                version: version.version,
                created_at: version.created_at.toISOString(),
                word_count: version.word_count,
                user: version.user
                    ? {
                        full_name: version.user.full_name,
                        email: version.user.email,
                    }
                    : null,
            }));
        }
        catch (error) {
            logger_1.default.error("Error fetching document versions:", error);
            throw error;
        }
    }
    // Add the restoreDocumentVersion method
    static async restoreDocumentVersion(projectId, versionId, userId) {
        try {
            // Verify user has access to project
            const project = await prisma_1.prisma.project.findFirst({
                where: {
                    id: projectId,
                    OR: [
                        { user_id: userId },
                        { collaborators: { some: { user_id: userId } } },
                        {
                            workspace: {
                                members: { some: { user_id: userId } },
                            },
                        },
                    ],
                },
            });
            if (!project) {
                throw new Error("Project not found or access denied");
            }
            // Get the specific version to restore
            const versionToRestore = await prisma_1.prisma.documentVersion.findUnique({
                where: { id: versionId },
            });
            if (!versionToRestore || versionToRestore.project_id !== projectId) {
                throw new Error("Version not found or does not belong to this project");
            }
            // Update the project content with the version content
            const updatedProject = await prisma_1.prisma.project.update({
                where: { id: projectId },
                data: {
                    content: versionToRestore.content,
                    word_count: versionToRestore.word_count,
                    updated_at: new Date(),
                },
                include: {
                    user: true,
                    collaborators: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    email: true,
                                    full_name: true,
                                },
                            },
                        },
                    },
                },
            });
            // Create a new version record to track the restoration
            // Get the latest version number and increment — NOT Date.now() (overflows INT4)
            const latestVersion = await prisma_1.prisma.documentVersion.findFirst({
                where: { project_id: projectId },
                orderBy: { version: "desc" },
                select: { version: true },
            });
            const nextVersionNumber = latestVersion ? latestVersion.version + 1 : 1;
            await prisma_1.prisma.documentVersion.create({
                data: {
                    project_id: projectId,
                    version: nextVersionNumber,
                    content: versionToRestore.content,
                    word_count: versionToRestore.word_count,
                    user_id: userId,
                },
            });
            logger_1.default.info(`[RESTORATION] Successfully restored document ${projectId} to version ${versionId}`, {
                userId,
                contentLength: JSON.stringify(versionToRestore.content).length,
                wordCount: versionToRestore.word_count,
            });
            return updatedProject;
        }
        catch (error) {
            logger_1.default.error("Error restoring document version:", error);
            throw error;
        }
    }
}
exports.EditorService = EditorService;
