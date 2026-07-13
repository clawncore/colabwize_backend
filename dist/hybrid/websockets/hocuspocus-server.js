"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HocuspocusCollaborationServer = void 0;
const server_1 = require("@hocuspocus/server");
const ws_1 = require("ws");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const prisma_1 = require("../../lib/prisma");
const auth_service_1 = require("../supabase/auth-service");
// Tiptap Extensions
const transformer_1 = require("@hocuspocus/transformer");
const starter_kit_1 = __importDefault(require("@tiptap/starter-kit"));
const extension_table_1 = require("@tiptap/extension-table");
const extension_table_cell_1 = require("@tiptap/extension-table-cell");
const extension_table_header_1 = require("@tiptap/extension-table-header");
const extension_table_row_1 = require("@tiptap/extension-table-row");
const extension_task_list_1 = __importDefault(require("@tiptap/extension-task-list"));
const extension_task_item_1 = __importDefault(require("@tiptap/extension-task-item"));
const extension_superscript_1 = __importDefault(require("@tiptap/extension-superscript"));
const extension_subscript_1 = __importDefault(require("@tiptap/extension-subscript"));
const extension_text_align_1 = require("@tiptap/extension-text-align");
const extension_typography_1 = require("@tiptap/extension-typography");
const extension_text_style_1 = require("@tiptap/extension-text-style");
const extension_color_1 = __importDefault(require("@tiptap/extension-color"));
const extension_font_family_1 = __importDefault(require("@tiptap/extension-font-family"));
const html_1 = require("@tiptap/html");
const happy_dom_1 = require("happy-dom");
const crypto_1 = require("crypto");
const Y = __importStar(require("yjs"));
const authorshipEvidenceService_1 = require("../../services/authorshipEvidenceService");
// Initialize a DOM environment for Tiptap's generateJSON to work in Node.js
const dom = new happy_dom_1.Window();
global.window = dom;
global.document = dom.document;
global.Node = dom.Node;
global.Element = dom.Element;
global.HTMLElement = dom.HTMLElement;
// Custom Extensions (Synchronized with Frontend)
const AuthorBlockExtension_1 = require("../../extensions/AuthorBlockExtension");
const AuthorExtension_1 = require("../../extensions/AuthorExtension");
const CalloutBlockExtension_1 = require("../../extensions/CalloutBlockExtension");
const CoverPageExtension_1 = require("../../extensions/CoverPageExtension");
const CustomCodeBlockExtension_1 = require("../../extensions/CustomCodeBlockExtension");
const KeywordsExtension_1 = require("../../extensions/KeywordsExtension");
const ListExtension_1 = require("../../extensions/ListExtension");
const PricingTableExtension_1 = require("../../extensions/PricingTableExtension");
const QuoteBlockExtension_1 = require("../../extensions/QuoteBlockExtension");
const SectionExtension_1 = require("../../extensions/SectionExtension");
const VisualElementExtension_1 = require("../../extensions/VisualElementExtension");
const HighlightExtension_1 = require("../../extensions/HighlightExtension");
const CitationNode_1 = require("../../extensions/CitationNode");
const GrammarExtension_1 = require("../../extensions/GrammarExtension");
const AITrackingExtension_1 = require("../../extensions/AITrackingExtension");
const MathExtension_1 = require("../../extensions/MathExtension");
const PlaceholderMarkExtension_1 = require("../../extensions/PlaceholderMarkExtension");
const EnhancedFigureNode_1 = require("../../extensions/EnhancedFigureNode");
const ImageExtension_1 = require("../../extensions/ImageExtension");
const AuthorshipExtension_1 = require("../../extensions/AuthorshipExtension");
const BibliographyNode_1 = require("../../extensions/BibliographyNode");
const ColumnLayoutExtension_1 = require("../../extensions/ColumnLayoutExtension");
// Cache to store content hashes to avoid unnecessary database writes
const lastStoredContentHashes = new Map();
class HocuspocusCollaborationServer {
    server;
    wss;
    port;
    updateQueue = new Map();
    isProcessingQueue = false;
    updateQueueTimer = null;
    getExtensions() {
        return [
            starter_kit_1.default.configure({
                history: false, // Collaborative mode handles history via Yjs
            }),
            extension_table_1.Table.configure({ resizable: true }),
            extension_table_row_1.TableRow,
            extension_table_header_1.TableHeader,
            extension_table_cell_1.TableCell,
            extension_task_list_1.default,
            extension_task_item_1.default.configure({ nested: true }),
            extension_superscript_1.default,
            extension_subscript_1.default,
            HighlightExtension_1.HighlightExtension, // Replaces standard Highlight with citation-highlight
            extension_text_align_1.TextAlign.configure({ types: ["heading", "paragraph"] }),
            extension_typography_1.Typography,
            extension_text_style_1.TextStyle,
            extension_color_1.default,
            extension_font_family_1.default,
            // Custom Extensions (Synchronized)
            AITrackingExtension_1.AITrackingExtension,
            AuthorBlockExtension_1.AuthorBlockExtension,
            AuthorExtension_1.AuthorExtension,
            CalloutBlockExtension_1.CalloutBlockExtension,
            CitationNode_1.CitationNode,
            CoverPageExtension_1.CoverPageExtension,
            CustomCodeBlockExtension_1.CustomCodeBlockExtension,
            EnhancedFigureNode_1.EnhancedFigureNode,
            GrammarExtension_1.GrammarExtension,
            KeywordsExtension_1.KeywordsExtension,
            ListExtension_1.ListExtension,
            MathExtension_1.MathExtension,
            PlaceholderMarkExtension_1.PlaceholderMarkExtension,
            PricingTableExtension_1.PricingTableExtension,
            QuoteBlockExtension_1.QuoteBlockExtension,
            SectionExtension_1.SectionExtension,
            VisualElementExtension_1.VisualElementExtension,
            ImageExtension_1.ImageExtension,
            AuthorshipExtension_1.AuthorshipExtension,
            BibliographyNode_1.BibliographyEntry,
            ColumnLayoutExtension_1.ColumnLayoutExtension,
        ];
    }
    calculateWordCount(content) {
        if (!content)
            return 0;
        let text = "";
        const extractText = (node) => {
            if (node.type === "text" && node.text) {
                text += node.text + " ";
            }
            if (node.content && Array.isArray(node.content)) {
                node.content.forEach(extractText);
            }
        };
        extractText(content);
        return text.trim().split(/\s+/).filter(Boolean).length;
    }
    constructor(port) {
        const self = this;
        this.port = port || 9081;
        this.wss = new ws_1.WebSocketServer({ noServer: true });
        logger_1.default.info("[HP-DIAG][HP] HocuspocusCollaborationServer initialized with WebSocketServer({ noServer: true })");
        this.wss.on("error", (error) => {
            logger_1.default.error("[HP-DIAG][HP] WSS Global Error:", error);
        });
        this.server = new server_1.Hocuspocus({
            // Only bind port if not multiplexing (handled by main server)
            port: port ? this.port : undefined,
            debounce: 1000,
            maxDebounce: 5000,
            timeout: 30000,
            unloadImmediately: true, // CRITICAL: Unload documents immediately when all clients disconnect to prevent stale data
            stopOnSignals: true,
            async onLoadDocument(data) {
                if (!data.documentName.startsWith("project-"))
                    return null;
                const projectId = data.documentName.replace("project-", "");
                const startTime = Date.now();
                try {
                    logger_1.default.info(`[HP] Loading document ${projectId}`, {
                        documentName: data.documentName,
                        timestamp: new Date().toISOString(),
                    });
                    const project = await prisma_1.prisma.project.findUnique({
                        where: { id: projectId },
                        select: { content: true },
                    });
                    // Define extensions locally for the static context if needed,
                    // or use instance bound method if Hocuspocus allows it (which it does via constructor closure)
                    const extensions = self.getExtensions();
                    if (project && project.content) {
                        let content = project.content;
                        // Handle legacy HTML content (common in uploaded documents)
                        if (typeof content === "string") {
                            logger_1.default.info(`[HP] Document ${projectId} content is HTML, generating JSON...`);
                            try {
                                content = (0, html_1.generateJSON)(content, extensions);
                                logger_1.default.info(`[HP] Successfully transformed HTML to JSON for document ${projectId}`);
                            }
                            catch (convError) {
                                logger_1.default.error(`[HP] Failed to convert HTML to JSON for ${projectId}:`, convError);
                                // Fallback to empty doc if conversion fails
                                content = { type: "doc", content: [{ type: "paragraph" }] };
                            }
                        }
                        // CRITICAL DIAGNOSTIC: Check for duplicate content in database
                        const contentStr = JSON.stringify(content);
                        const contentObj = typeof content === "string" ? JSON.parse(content) : content;
                        const paragraphs = contentObj?.content || [];
                        // Check for consecutive duplicates
                        let dupes = 0;
                        if (paragraphs.length > 1) {
                            for (let i = 0; i < paragraphs.length - 1; i++) {
                                if (JSON.stringify(paragraphs[i]) === JSON.stringify(paragraphs[i + 1])) {
                                    dupes++;
                                }
                            }
                        }
                        // Check for full document duplication
                        let fullDupe = false;
                        if (paragraphs.length > 3) {
                            const mid = Math.floor(paragraphs.length / 2);
                            const firstHalf = paragraphs.slice(0, mid);
                            const secondHalf = paragraphs.slice(mid);
                            if (JSON.stringify(firstHalf) === JSON.stringify(secondHalf)) {
                                fullDupe = true;
                            }
                        }
                        if (dupes > 0 || fullDupe) {
                            logger_1.default.error(`[HP] CRITICAL: Database content for ${projectId} has duplication:`, { dupes, fullDupe, paragraphs: paragraphs.length });
                        }
                        const duration = Date.now() - startTime;
                        logger_1.default.info(`[HP] Document ${projectId} loaded and transformed in ${duration}ms`, {
                            contentSize: contentStr.length,
                            paragraphs: paragraphs.length,
                            dupes,
                            fullDupe,
                        });
                        return transformer_1.TiptapTransformer.extensions(extensions).toYdoc(content, "default");
                    }
                    else if (project) {
                        logger_1.default.info(`Project ${projectId} exists but content is empty, returning default structure`);
                        // Return empty project structure if project exists but content is null
                        return transformer_1.TiptapTransformer.extensions(extensions).toYdoc({ type: "doc", content: [{ type: "paragraph" }] }, "default");
                    }
                    else {
                        logger_1.default.warn(`Project ${projectId} not found in database`);
                    }
                }
                catch (error) {
                    logger_1.default.error(`Failed to load document ${projectId}:`, error);
                }
                return null;
            },
            async onStoreDocument(data) {
                const { document, documentName } = data;
                try {
                    if (!documentName.startsWith("project-"))
                        return;
                    const projectId = documentName.replace("project-", "");
                    // Use TiptapTransformer to correctly serialize Yjs document to Tiptap JSON
                    const extensions = self.getExtensions();
                    const content = transformer_1.TiptapTransformer.extensions(extensions).fromYdoc(document, "default");
                    logger_1.default.info(`Attempting to store document ${projectId}`, {
                        documentName,
                        contentSize: content ? JSON.stringify(content).length : 0,
                        timestamp: new Date().toISOString(),
                    });
                    if (!content || content.content?.length === 0) {
                        logger_1.default.warn("Attempted to store empty or invalid document, skipping", { projectId });
                        return;
                    }
                    // Manual validation logic removed in favor of TiptapTransformer.fromYdoc
                    // which correctly handles the schema and type mappings
                    // Calculate hash and word count OUTSIDE the transaction to minimize lock time
                    const contentHash = JSON.stringify(content);
                    const lastHash = lastStoredContentHashes.get(projectId);
                    const wordCount = self.calculateWordCount(content);
                    // Skip storing if content hasn't changed
                    if (contentHash === lastHash && lastHash !== undefined) {
                        logger_1.default.info("Document content unchanged, skipping store", {
                            projectId,
                            timestamp: new Date().toISOString(),
                        });
                        return;
                    }
                    lastStoredContentHashes.set(projectId, contentHash);
                    logger_1.default.info(`Starting database transaction for ${projectId}`);
                    // Use a database transaction to ensure consistency
                    // Increased timeout to 30s to handle database latency spikes
                    await prisma_1.prisma.$transaction(async (tx) => {
                        const current = await tx.project.findUnique({
                            where: { id: projectId },
                            select: { id: true, content: true, updated_at: true },
                        });
                        if (!current) {
                            throw new Error(`Project not found: ${projectId}`);
                        }
                        const currentContentHash = JSON.stringify(current.content);
                        // Check if content has changed since we last read it (to detect parallel saves)
                        if (currentContentHash !== lastHash && lastHash !== undefined) {
                            logger_1.default.warn("Parallel save detected in onStoreDocument - Hocuspocus overwriting", {
                                projectId,
                                timestamp: new Date().toISOString(),
                            });
                        }
                        // Update the project with new content and updated word count
                        await tx.project.update({
                            where: { id: projectId },
                            data: {
                                content: content,
                                word_count: wordCount,
                                updated_at: new Date(),
                            },
                        });
                    }, {
                        timeout: 30000, // 30 seconds
                    });
                    logger_1.default.info("Document stored in database (no version created)", {
                        projectId,
                        timestamp: new Date().toISOString(),
                        message: "Frequent save for CRDT protection, not versioning",
                    });
                }
                catch (error) {
                    logger_1.default.error("Error storing document:", {
                        error: error.message || error,
                        stack: error.stack,
                        documentName,
                        timestamp: new Date().toISOString(),
                    });
                }
            },
            async onChange(data) {
                if (!data.documentName.startsWith("project-"))
                    return;
                const projectId = data.documentName.replace("project-", "");
                const context = (data.context || {});
                if (!context.id || !context.serverSessionId) {
                    logger_1.default.warn("Skipping authorship update evidence: missing context", {
                        projectId,
                        context,
                    });
                    return;
                }
                self.queueAuthorshipUpdate({
                    projectId,
                    documentName: data.documentName,
                    context,
                    receivedAt: new Date(),
                });
            },
            async onAuthenticate(data) {
                const { token, documentName, parameters } = data;
                logger_1.default.info(`[HP-DIAG][HP] Authenticating for document: ${documentName}`, {
                    hasToken: !!token,
                    tokenType: typeof token,
                    tokenLength: token?.length,
                    parameters: parameters ? Object.keys(parameters) : "none",
                });
                const authStartTime = Date.now();
                // Log the authentication attempt
                logger_1.default.info("[HP-DIAG][HP] WebSocket connection attempt", {
                    documentName,
                    documentNameType: typeof documentName,
                    documentNameLength: documentName?.length,
                    documentNamePreview: documentName
                        ? documentName.substring(0, 100)
                        : null,
                    hasToken: !!token,
                    hasParameters: !!parameters,
                    timestamp: new Date().toISOString(),
                });
                try {
                    // Helper function to safely stringify objects with circular references
                    const safeStringify = (obj, space = 2) => {
                        const seen = new WeakSet();
                        return JSON.stringify(obj, (key, val) => {
                            if (val != null && typeof val == "object") {
                                if (seen.has(val))
                                    return "[Circular]";
                                seen.add(val);
                            }
                            return val;
                        }, space);
                    };
                    logger_1.default.info("Full authentication data received", {
                        documentName,
                        token: token ? `${token.substring(0, 10)}...` : null,
                        tokenLength: token?.length || 0,
                        hasParameters: !!parameters,
                        parameters: parameters ? Object.keys(parameters) : null,
                        parametersToken: parameters?.token
                            ? `${parameters.token.substring(0, 10)}...`
                            : null,
                        parametersTokenLength: parameters?.token?.length || 0,
                        allDataKeys: Object.keys(data),
                        dataSample: safeStringify(data).substring(0, 500),
                        documentNameParts: documentName?.split("?"),
                        timestamp: new Date().toISOString(),
                    });
                    logger_1.default.info("Detailed data inspection", {
                        hasTokenDirectly: !!token,
                        hasTokenInParameters: !!(parameters && parameters.token),
                        hasTokenInConnection: !!data.connection?.token,
                        hasTokenInData: !!data.token,
                        hasTokenInAuth: !!data.auth?.token,
                        hasTokenInConnectionParameters: !!data.connectionParameters
                            ?.token,
                        documentNameContainsQuery: documentName?.includes("?"),
                        documentNameQueryParams: documentName?.split("?")[1],
                    });
                    logger_1.default.info("Raw data structure inspection", {
                        dataKeys: Object.keys(data),
                        hasConnection: !!data.connection,
                        connectionType: data.connection
                            ? typeof data.connection
                            : null,
                        hasRequest: !!data.request,
                        requestType: data.request
                            ? typeof data.request
                            : null,
                        hasInstance: !!data.instance,
                        instanceType: data.instance
                            ? typeof data.instance
                            : null,
                    });
                    logger_1.default.debug("Raw authentication data", {
                        rawDataKeys: Object.keys(data),
                        rawParameters: parameters,
                        rawToken: token,
                    });
                    // Try to extract the token from various possible locations
                    let authToken = token;
                    if (!authToken && parameters && parameters.token) {
                        authToken = parameters.token;
                    }
                    if (!authToken && data.token) {
                        authToken = data.token;
                    }
                    if (!authToken && data.connection?.token) {
                        authToken = data.connection.token;
                    }
                    if (!authToken && data.connectionParameters?.token) {
                        authToken = data.connectionParameters.token;
                    }
                    if (!authToken && data.auth?.token) {
                        authToken = data.auth.token;
                    }
                    // Try to extract token from documentName as query parameter
                    if (!authToken) {
                        try {
                            const parts = documentName.split("?");
                            logger_1.default.debug("Document name parts for token extraction", {
                                parts: parts,
                                partsLength: parts.length,
                            });
                            if (parts.length > 1) {
                                const urlParams = new URLSearchParams(parts[1]);
                                const urlToken = urlParams.get("token");
                                logger_1.default.debug("URL token extraction result", {
                                    hasUrlToken: !!urlToken,
                                    urlTokenPreview: urlToken ? urlToken.substring(0, 10) : null,
                                });
                                if (urlToken) {
                                    authToken = urlToken;
                                }
                            }
                        }
                        catch (urlError) {
                            logger_1.default.debug("Could not parse token from URL", {
                                error: urlError,
                            });
                        }
                    }
                    // Final attempt to extract token from documentName as URL
                    if (!authToken) {
                        try {
                            let documentUrl;
                            if (documentName.startsWith("http") ||
                                documentName.startsWith("ws")) {
                                documentUrl = new URL(documentName);
                            }
                            else {
                                documentUrl = new URL(`http://localhost/${documentName}`);
                            }
                            const urlToken = documentUrl.searchParams.get("token");
                            logger_1.default.debug("Final token extraction attempt", {
                                hasUrlToken: !!urlToken,
                                urlTokenPreview: urlToken ? urlToken.substring(0, 10) : null,
                            });
                            if (urlToken) {
                                authToken = urlToken;
                            }
                        }
                        catch (urlError) {
                            logger_1.default.debug("Could not parse documentName as URL", {
                                error: urlError,
                                documentName: documentName,
                            });
                        }
                    }
                    if (authToken) {
                        logger_1.default.info("Token found", {
                            source: token
                                ? "direct"
                                : parameters?.token
                                    ? "parameters"
                                    : "data",
                            tokenLength: authToken.length,
                            timestamp: new Date().toISOString(),
                        });
                    }
                    // If no token found, reject the connection
                    if (!authToken) {
                        logger_1.default.warn("Authentication failed: No token provided", {
                            documentName,
                            tokenSources: {
                                directToken: !!token,
                                parametersToken: !!(parameters && parameters.token),
                                dataToken: !!data.token,
                                connectionToken: !!data.connection?.token,
                                connectionParametersToken: !!data.connectionParameters
                                    ?.token,
                                authToken: !!data.auth?.token,
                            },
                            receivedData: {
                                hasToken: !!token,
                                hasParameters: !!parameters,
                                parametersKeys: parameters ? Object.keys(parameters) : null,
                                dataKeys: Object.keys(data),
                            },
                            timestamp: new Date().toISOString(),
                        });
                        logger_1.default.info("Sending AUTH_REQUIRED response to client");
                        const authRequiredError = new Error("AUTH_REQUIRED: No authentication token provided. Please ensure you are logged in and have a valid session.");
                        authRequiredError.code = "AUTH_REQUIRED";
                        authRequiredError.reason = "AUTH_REQUIRED";
                        throw authRequiredError;
                    }
                    let userRecord;
                    try {
                        logger_1.default.info("Using AuthService.supabase for token verification");
                        const supabaseClient = await auth_service_1.AuthService.supabase;
                        logger_1.default.info("Attempting Supabase getUser verification", {
                            tokenPreview: authToken
                                ? `${authToken.substring(0, 10)}...`
                                : "NONE",
                            tokenLength: authToken?.length,
                        });
                        const result = await supabaseClient.auth.getUser(authToken);
                        const { data: userData, error } = result;
                        if (error || !userData?.user) {
                            logger_1.default.warn("Authentication failed: Supabase Auth error", {
                                documentName,
                                error: error?.message,
                                errorCode: error?.code,
                                errorStatus: error?.status,
                                tokenExpired: error?.message?.includes("token is expired"),
                                timestamp: new Date().toISOString(),
                            });
                            if (error?.message &&
                                (error.message.includes("token is expired") ||
                                    error.message.includes("Invalid JWT") ||
                                    error.code === "invalid_jwt")) {
                                logger_1.default.warn("Token expired or invalid, requesting client to refresh", {
                                    documentName,
                                    userId: result.data?.user?.id || "unknown",
                                    errorCode: error?.code,
                                    errorStatus: error?.status,
                                    timestamp: new Date().toISOString(),
                                });
                                const tokenExpiredError = new Error("TOKEN_EXPIRED: Authentication token has expired");
                                tokenExpiredError.code = "TOKEN_EXPIRED";
                                tokenExpiredError.reason = "TOKEN_EXPIRED";
                                throw tokenExpiredError;
                            }
                            throw new Error(`Authentication failed: ${error?.message || "Unknown error"}`);
                        }
                        userRecord = userData.user;
                    }
                    catch (error) {
                        logger_1.default.warn("Authentication failed: Supabase Auth error", {
                            documentName,
                            error: error.message,
                            stack: error.stack,
                            timestamp: new Date().toISOString(),
                        });
                        if (error.message &&
                            (error.message.includes("token is expired") ||
                                error.message.includes("Invalid JWT"))) {
                            logger_1.default.warn("Token expired or invalid, requesting client to refresh", {
                                documentName,
                                userId: error.userId || "unknown",
                                timestamp: new Date().toISOString(),
                            });
                            const tokenExpiredError = new Error("TOKEN_EXPIRED: Authentication token has expired");
                            tokenExpiredError.code = "TOKEN_EXPIRED";
                            tokenExpiredError.reason = "TOKEN_EXPIRED";
                            throw tokenExpiredError;
                        }
                        throw new Error(`Authentication failed: ${error.message}`);
                    }
                    if (!userRecord) {
                        logger_1.default.warn("Authentication failed: No user found", {
                            documentName,
                            timestamp: new Date().toISOString(),
                        });
                        throw new Error("Authentication failed: No user found");
                    }
                    // Extract project or workspace ID from document name
                    const projectIdMatch = documentName.match(/^project-(.+)$/);
                    const workspaceIdMatch = documentName.match(/^workspace-(.+)$/);
                    if (!projectIdMatch && !workspaceIdMatch) {
                        logger_1.default.warn("Invalid document name format", {
                            documentName,
                            timestamp: new Date().toISOString(),
                        });
                        throw new Error("Invalid document name format");
                    }
                    let authenticatedId = "";
                    let type = "";
                    if (projectIdMatch) {
                        authenticatedId = projectIdMatch[1];
                        type = "project";
                        try {
                            // Check if user has access to the project
                            const project = await prisma_1.prisma.project.findFirst({
                                where: {
                                    id: authenticatedId,
                                    OR: [
                                        { user_id: userRecord.id },
                                        { collaborators: { some: { user_id: userRecord.id } } },
                                        {
                                            workspace: {
                                                members: { some: { user_id: userRecord.id } },
                                            },
                                        },
                                    ],
                                },
                            });
                            if (!project) {
                                logger_1.default.warn("User access denied to project", {
                                    documentName,
                                    userId: userRecord.id,
                                    projectId: authenticatedId,
                                    timestamp: new Date().toISOString(),
                                });
                                throw new Error("Access denied: User does not have permission to access this document");
                            }
                        }
                        catch (dbError) {
                            logger_1.default.error("Database error during project authentication", {
                                documentName,
                                userId: userRecord.id,
                                error: dbError.message,
                            });
                            throw dbError;
                        }
                    }
                    else if (workspaceIdMatch) {
                        authenticatedId = workspaceIdMatch[1];
                        type = "workspace";
                        try {
                            // Check if user is a member of the workspace
                            const workspaceMember = await prisma_1.prisma.workspaceMember.findFirst({
                                where: {
                                    workspace_id: authenticatedId,
                                    user_id: userRecord.id,
                                },
                            });
                            if (!workspaceMember) {
                                logger_1.default.warn("User access denied to workspace", {
                                    documentName,
                                    userId: userRecord.id,
                                    workspaceId: authenticatedId,
                                    timestamp: new Date().toISOString(),
                                });
                                throw new Error("Access denied: User is not a member of this workspace");
                            }
                        }
                        catch (dbError) {
                            logger_1.default.error("Database error during workspace authentication", {
                                documentName,
                                userId: userRecord.id,
                                error: dbError.message,
                            });
                            throw dbError;
                        }
                    }
                    const authDuration = Date.now() - authStartTime;
                    const serverSessionId = (0, crypto_1.randomUUID)();
                    const socketId = data.connection?.socketId || data.socketId || null;
                    logger_1.default.info("[HP] User authenticated successfully", {
                        documentName,
                        userId: userRecord.id,
                        userEmail: userRecord.email,
                        id: authenticatedId,
                        type,
                        serverSessionId,
                        duration_ms: authDuration,
                        timestamp: new Date().toISOString(),
                    });
                    if (type === "project") {
                        try {
                            await prisma_1.prisma.authorshipCollaborationSession.create({
                                data: {
                                    project_id: authenticatedId,
                                    user_id: userRecord.id,
                                    server_session_id: serverSessionId,
                                    client_session_id: parameters?.sessionId || null,
                                    socket_id: socketId,
                                    status: "active",
                                    metadata: {
                                        documentName,
                                        authenticatedAt: new Date().toISOString(),
                                    },
                                },
                            });
                        }
                        catch (sessionError) {
                            logger_1.default.warn("Failed to create authorship collaboration session", {
                                error: sessionError,
                                projectId: authenticatedId,
                                userId: userRecord.id,
                                serverSessionId,
                            });
                        }
                    }
                    // Return user information for the WebSocket connection.
                    // This context is used by Hocuspocus hooks and future authorship attribution.
                    return {
                        id: userRecord.id,
                        name: userRecord.user_metadata?.full_name ||
                            userRecord.email?.split("@")[0] ||
                            "User",
                        email: userRecord.email,
                        serverSessionId,
                        clientSessionId: parameters?.sessionId || null,
                    };
                }
                catch (error) {
                    logger_1.default.error("Authentication error", {
                        documentName,
                        error: error.message,
                        stack: error.stack,
                        timestamp: new Date().toISOString(),
                    });
                    throw error;
                }
            },
            async onDisconnect(data) {
                const { documentName, socketId, context } = data;
                const disconnectContext = (context || {});
                logger_1.default.info("Client disconnected", {
                    documentName,
                    socketId,
                    timestamp: new Date().toISOString(),
                });
                // Only handle project-specific presence cleanup
                if (documentName.startsWith("project-")) {
                    try {
                        const projectId = documentName.replace("project-", "");
                        const userId = disconnectContext.id;
                        if (projectId && userId) {
                            // Update user presence to offline in the database
                            try {
                                await prisma_1.prisma.$transaction([
                                    prisma_1.prisma.collaboratorPresence.update({
                                        where: {
                                            project_id_user_id: {
                                                project_id: projectId,
                                                user_id: userId,
                                            },
                                        },
                                        data: {
                                            last_active_at: new Date(),
                                        },
                                    }).catch(() => undefined),
                                    prisma_1.prisma.authorshipCollaborationSession.updateMany({
                                        where: {
                                            project_id: projectId,
                                            user_id: userId,
                                            status: "active",
                                            ...(disconnectContext.serverSessionId
                                                ? { server_session_id: disconnectContext.serverSessionId }
                                                : {}),
                                        },
                                        data: {
                                            status: "disconnected",
                                            disconnected_at: new Date(),
                                        },
                                    }),
                                ]);
                                logger_1.default.info("User marked as offline in presence database", {
                                    project_id: projectId,
                                    user_id: userId,
                                    timestamp: new Date().toISOString(),
                                });
                            }
                            catch (presenceError) {
                                logger_1.default.error("Error updating user presence on disconnect:", {
                                    error: presenceError.message,
                                    project_id: projectId,
                                    user_id: userId,
                                    timestamp: new Date().toISOString(),
                                });
                            }
                        }
                    }
                    catch (error) {
                        logger_1.default.error("Error marking user as offline in presence system:", {
                            error,
                            documentName,
                            socketId,
                        });
                    }
                }
            },
            async onAwarenessUpdate(data) {
                const { documentName, added, updated, removed } = data;
                logger_1.default.debug("Awareness updated", {
                    documentName,
                    added,
                    updated,
                    removed,
                    timestamp: new Date().toISOString(),
                });
            },
        });
    }
    async start() {
        try {
            await this.server.listen();
            logger_1.default.info(`Hocuspocus server started on port ${this.port}`, {
                port: this.port,
                timestamp: new Date().toISOString(),
            });
        }
        catch (error) {
            logger_1.default.error("Failed to start Hocuspocus server", {
                error: error.message,
                stack: error.stack,
                port: this.port,
                timestamp: new Date().toISOString(),
            });
            throw error;
        }
    }
    async stop() {
        try {
            await this.server.destroy();
            logger_1.default.info("Hocuspocus server stopped", {
                timestamp: new Date().toISOString(),
            });
        }
        catch (error) {
            logger_1.default.error("Error stopping Hocuspocus server", {
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString(),
            });
        }
    }
    handleUpgrade(request, socket, head) {
        const url = request.url;
        logger_1.default.info(`[HP-DIAG][HP] handleUpgrade called for URL: ${url}`, {
            headers: request.headers,
            socketWritable: socket.writable,
            socketReadable: socket.readable,
            headLength: head?.length,
        });
        socket.on("error", (err) => {
            logger_1.default.error(`[HP-DIAG][HP] Socket Error during upgrade for ${url}:`, err);
        });
        try {
            this.wss.handleUpgrade(request, socket, head, (ws) => {
                logger_1.default.info(`[HP-DIAG][HP] WebSocket upgrade successful for URL: ${request.url}`);
                // Add raw listeners to debug silent failures
                ws.on("message", (msg) => {
                    logger_1.default.info(`[HP-DIAG] Raw WS message received: ${msg.length} bytes`);
                });
                ws.on("close", (code, reason) => {
                    logger_1.default.info(`[HP-DIAG] Raw WS closed: ${code} ${reason?.toString() || ""}`);
                });
                // Use any to bypass TS error for handleConnection parameters if needed
                this.server.handleConnection(ws, request, {});
            });
        }
        catch (err) {
            logger_1.default.error(`[HP-DIAG][HP] Exception in handleUpgrade for ${url}:`, err);
            socket.destroy();
        }
    }
    getServerInstance() {
        return this.server;
    }
    queueAuthorshipUpdate(update) {
        const queueKey = `${update.projectId}:${update.context.id}:${update.context.serverSessionId}`;
        this.updateQueue.set(queueKey, update);
        if (this.updateQueueTimer) {
            clearTimeout(this.updateQueueTimer);
        }
        this.updateQueueTimer = setTimeout(() => {
            void this.processUpdateQueue();
        }, 5000);
    }
    hashYjsDocument(document) {
        const stateVector = Y.encodeStateVector(document);
        return (0, crypto_1.createHash)("sha256")
            .update(Buffer.from(stateVector))
            .digest("hex");
    }
    async processUpdateQueue() {
        if (this.isProcessingQueue)
            return;
        this.isProcessingQueue = true;
        try {
            const queuedUpdates = Array.from(this.updateQueue.values());
            this.updateQueue.clear();
            this.updateQueueTimer = null;
            for (const updateData of queuedUpdates) {
                try {
                    logger_1.default.debug("Processing queued update", {
                        projectId: updateData.projectId,
                        timestamp: updateData.receivedAt.toISOString(),
                    });
                    const document = await this.server.documents.get(updateData.projectId);
                    if (!document) {
                        logger_1.default.warn("Skipping authorship update evidence: document not loaded", {
                            projectId: updateData.projectId,
                        });
                        continue;
                    }
                    const updateHash = this.hashYjsDocument(document);
                    await authorshipEvidenceService_1.AuthorshipEvidenceService.recordServerObservedEdit({
                        projectId: updateData.projectId,
                        userId: updateData.context.id || "",
                        sessionId: updateData.context.serverSessionId || "",
                        clientSessionId: updateData.context.clientSessionId,
                        updateHash,
                        payload: {
                            documentName: updateData.documentName,
                            serverReceivedAt: updateData.receivedAt.toISOString(),
                            evidenceKind: "hocuspocus_state_vector",
                        },
                    });
                }
                catch (error) {
                    logger_1.default.error("Error recording authorship update evidence", {
                        projectId: updateData.projectId,
                        userId: updateData.context.id,
                        error: error.message,
                        timestamp: new Date().toISOString(),
                    });
                }
            }
        }
        catch (error) {
            logger_1.default.error("Error processing update queue", {
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString(),
            });
        }
        finally {
            this.isProcessingQueue = false;
        }
    }
}
exports.HocuspocusCollaborationServer = HocuspocusCollaborationServer;
