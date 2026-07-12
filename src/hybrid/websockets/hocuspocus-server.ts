import {
  Hocuspocus,
  onLoadDocumentPayload,
  onStoreDocumentPayload,
  onDisconnectPayload,
  onAwarenessUpdatePayload,
  onChangePayload,
} from "@hocuspocus/server";
import { WebSocketServer } from "ws";
import logger from "../../monitoring/logger";
import { prisma } from "../../lib/prisma";
import { AuthService } from "../supabase/auth-service";
// Tiptap Extensions
import { TiptapTransformer } from "@hocuspocus/transformer";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import { TextAlign } from "@tiptap/extension-text-align";
import { Typography } from "@tiptap/extension-typography";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import { generateJSON } from "@tiptap/html";
import { Window } from "happy-dom";
import { createHash, randomUUID } from "crypto";
import * as Y from "yjs";
import { AuthorshipEvidenceService } from "../../services/authorshipEvidenceService";

// Initialize a DOM environment for Tiptap's generateJSON to work in Node.js
const dom = new Window();
(global as any).window = dom;
(global as any).document = dom.document;
(global as any).Node = dom.Node;
(global as any).Element = dom.Element;
(global as any).HTMLElement = dom.HTMLElement;

// Custom Extensions (Synchronized with Frontend)
import { AuthorBlockExtension } from "../../extensions/AuthorBlockExtension";
import { AuthorExtension } from "../../extensions/AuthorExtension";
import { CalloutBlockExtension } from "../../extensions/CalloutBlockExtension";
import { CoverPageExtension } from "../../extensions/CoverPageExtension";
import { CustomCodeBlockExtension } from "../../extensions/CustomCodeBlockExtension";
import { KeywordsExtension } from "../../extensions/KeywordsExtension";
import { ListExtension } from "../../extensions/ListExtension";
import { PricingTableExtension } from "../../extensions/PricingTableExtension";
import { QuoteBlockExtension } from "../../extensions/QuoteBlockExtension";
import { SectionExtension } from "../../extensions/SectionExtension";
import { VisualElementExtension } from "../../extensions/VisualElementExtension";
import { HighlightExtension } from "../../extensions/HighlightExtension";
import { CitationNode } from "../../extensions/CitationNode";
import { GrammarExtension } from "../../extensions/GrammarExtension";
import { AITrackingExtension } from "../../extensions/AITrackingExtension";
import { MathExtension } from "../../extensions/MathExtension";
import { PlaceholderMarkExtension } from "../../extensions/PlaceholderMarkExtension";
import { EnhancedFigureNode } from "../../extensions/EnhancedFigureNode";
import { ImageExtension } from "../../extensions/ImageExtension";
import { AuthorshipExtension } from "../../extensions/AuthorshipExtension";
import { BibliographyEntry } from "../../extensions/BibliographyNode";
import { ColumnLayoutExtension } from "../../extensions/ColumnLayoutExtension";

interface onAuthenticatePayload {
  token: string;
  documentName: string;
  parameters?: {
    token?: string;
    [key: string]: any; // Allow additional parameters
  };
  connection?: {
    token?: string;
    [key: string]: any; // Allow additional connection properties
  };
  [key: string]: any; // Allow additional properties in the payload
}

interface QueuedAuthorshipUpdate {
  projectId: string;
  documentName: string;
  context: {
    id?: string;
    serverSessionId?: string;
    clientSessionId?: string;
  };
  receivedAt: Date;
}

// Cache to store content hashes to avoid unnecessary database writes
const lastStoredContentHashes = new Map<string, string>();

export class HocuspocusCollaborationServer {
  private server: Hocuspocus;
  private wss: WebSocketServer;
  private port: number;
  private updateQueue = new Map<string, QueuedAuthorshipUpdate>();
  private isProcessingQueue = false;
  private updateQueueTimer: NodeJS.Timeout | null = null;

  private getExtensions() {
    return [
      StarterKit.configure({
        history: false, // Collaborative mode handles history via Yjs
      } as any),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      Superscript,
      Subscript,
      HighlightExtension, // Replaces standard Highlight with citation-highlight
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Typography,
      TextStyle,
      Color,
      FontFamily,
      // Custom Extensions (Synchronized)
      AITrackingExtension,
      AuthorBlockExtension,
      AuthorExtension,
      CalloutBlockExtension,
      CitationNode,
      CoverPageExtension,
      CustomCodeBlockExtension,
      EnhancedFigureNode,
      GrammarExtension,
      KeywordsExtension,
      ListExtension,
      MathExtension,
      PlaceholderMarkExtension,
      PricingTableExtension,
      QuoteBlockExtension,
      SectionExtension,
      VisualElementExtension,
      ImageExtension,
      AuthorshipExtension,
      BibliographyEntry,
      ColumnLayoutExtension,
    ];
  }

  private calculateWordCount(content: any): number {
    if (!content) return 0;

    let text = "";
    const extractText = (node: any) => {
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

  constructor(port?: number) {
    const self = this;
    this.port = port || 9081;
    this.wss = new WebSocketServer({ noServer: true });
    logger.info(
      "[HP-DIAG][HP] HocuspocusCollaborationServer initialized with WebSocketServer({ noServer: true })",
    );
    this.wss.on("error", (error) => {
      logger.error("[HP-DIAG][HP] WSS Global Error:", error);
    });

    this.server = new Hocuspocus({
      // Only bind port if not multiplexing (handled by main server)
      port: port ? this.port : undefined,
      debounce: 2000,
      maxDebounce: 10000,
      timeout: 30000,
      // Keep the in-memory Y.Doc alive while at least one client is connected.
      // Setting this to true was the primary cause of content duplication:
      // it destroyed the CRDT state on disconnect, forcing onLoadDocument to
      // re-convert JSON → Y.Doc on every reconnect, which re-inserts content.
      unloadImmediately: false,
      stopOnSignals: true,
      async onLoadDocument(data: onLoadDocumentPayload) {
        if (!data.documentName.startsWith("project-")) return null;

        const projectId = data.documentName.replace("project-", "");
        const startTime = Date.now();
        try {
          logger.info(`[HP] Loading document ${projectId}`, {
            documentName: data.documentName,
            timestamp: new Date().toISOString(),
          });

          const project = await prisma.project.findUnique({
            where: { id: projectId },
            select: { content: true, ydoc: true },
          });

          const extensions = self.getExtensions();

          if (!project) {
            logger.warn(`[HP] Project ${projectId} not found in database`);
            return null;
          }

          // ─── PRIMARY PATH: Binary Yjs state ────────────────────────────────
          // Binary state is a perfect, lossless snapshot of the Yjs CRDT. Loading
          // it via Y.applyUpdate avoids the JSON → Yjs re-insertion that caused
          // content duplication on every reconnect.
          if (project.ydoc && project.ydoc.length > 0) {
            const Y = await import("yjs");
            const ydoc = new Y.Doc();
            Y.applyUpdate(ydoc, project.ydoc);
            const duration = Date.now() - startTime;
            logger.info(
              `[HP] Document ${projectId} loaded from binary ydoc state in ${duration}ms`,
              { binarySize: project.ydoc.length },
            );
            return ydoc;
          }

          // ─── FALLBACK PATH: JSON content (existing documents) ──────────────
          // Used for documents that have never been saved in binary mode yet.
          // After the first onStoreDocument call, they will have a ydoc field
          // and will use the primary path on all subsequent loads.
          if (project.content) {
            let content = project.content;

            // Handle legacy HTML content (common in uploaded documents)
            if (typeof content === "string") {
              logger.info(
                `[HP] Document ${projectId} content is HTML string, converting to JSON...`,
              );
              try {
                content = generateJSON(content, extensions);
              } catch (convError) {
                logger.error(
                  `[HP] Failed to convert HTML to JSON for ${projectId}:`,
                  convError,
                );
                content = { type: "doc", content: [{ type: "paragraph" }] };
              }
            }

            const duration = Date.now() - startTime;
            logger.info(
              `[HP] Document ${projectId} loaded from JSON (first-time binary migration) in ${duration}ms`,
              { contentSize: JSON.stringify(content).length },
            );
            return TiptapTransformer.extensions(extensions as any).toYdoc(
              content,
              "default",
            );
          }

          // Empty project — return a blank document
          logger.info(
            `[HP] Project ${projectId} has no content, returning empty document`,
          );
          return TiptapTransformer.extensions(extensions as any).toYdoc(
            { type: "doc", content: [{ type: "paragraph" }] },
            "default",
          );
        } catch (error) {
          logger.error(`[HP] Failed to load document ${projectId}:`, error);
        }
        return null;
      },
      async onStoreDocument(data: onStoreDocumentPayload) {
        const { document, documentName } = data;
        try {
          if (!documentName.startsWith("project-")) return;
          const projectId = documentName.replace("project-", "");

          // ─── BINARY STATE (primary, lossless) ─────────────────────────────
          // Encode the live Yjs document as a compact binary update. This is the
          // canonical, lossless representation of the CRDT state. Loading it back
          // via Y.applyUpdate perfectly reconstructs the document without any
          // re-insertion or duplication.
          const Y = await import("yjs");
          const binaryState = Buffer.from(Y.encodeStateAsUpdate(document));

          // ─── JSON CONTENT (secondary, for REST API / exports) ─────────────
          // Also serialize to JSON so that REST endpoints, version history,
          // exports, and word-count still work without changes.
          const extensions = self.getExtensions();
          const content = TiptapTransformer.extensions(
            extensions as any,
          ).fromYdoc(document, "default");

          logger.info(`[HP] Storing document ${projectId}`, {
            documentName,
            binarySize: binaryState.length,
            contentSize: content ? JSON.stringify(content).length : 0,
            timestamp: new Date().toISOString(),
          });

          if (!content || (content as any).content?.length === 0) {
            logger.warn(
              "[HP] Attempted to store empty or invalid document, skipping",
              { projectId },
            );
            return;
          }

          // Deduplicate using a hash of the binary state (more reliable than JSON)
          const binaryHash = binaryState.toString("base64");
          const lastHash = lastStoredContentHashes.get(projectId);
          const wordCount = self.calculateWordCount(content);

          if (binaryHash === lastHash && lastHash !== undefined) {
            logger.info("[HP] Document unchanged (binary hash match), skipping store", {
              projectId,
              timestamp: new Date().toISOString(),
            });
            return;
          }

          lastStoredContentHashes.set(projectId, binaryHash);

          // Persist both binary CRDT state and JSON in a single transaction
          await prisma.$transaction(
            async (tx: any) => {
              const exists = await tx.project.findUnique({
                where: { id: projectId },
                select: { id: true },
              });

              if (!exists) {
                throw new Error(`[HP] Project not found: ${projectId}`);
              }

              await tx.project.update({
                where: { id: projectId },
                data: {
                  ydoc: binaryState,      // Binary CRDT state — primary load path
                  content: content,       // JSON — for REST API / exports / word count
                  word_count: wordCount,
                  updated_at: new Date(),
                },
              });
            },
            { timeout: 30000 },
          );

          logger.info("[HP] Document stored successfully (binary + JSON)", {
            projectId,
            binarySize: binaryState.length,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          logger.error("[HP] Error storing document:", {
            error: (error as Error).message || error,
            stack: (error as Error).stack,
            documentName,
            timestamp: new Date().toISOString(),
          });
        }
      },
      async onChange(data: onChangePayload) {
        if (!data.documentName.startsWith("project-")) return;

        const projectId = data.documentName.replace("project-", "");
        const context = (data.context || {}) as {
          id?: string;
          serverSessionId?: string;
          clientSessionId?: string;
        };

        if (!context.id || !context.serverSessionId) {
          logger.warn("Skipping authorship update evidence: missing context", {
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
      async onAuthenticate(data: onAuthenticatePayload) {
        const { token, documentName, parameters } = data;

        logger.info(
          `[HP-DIAG][HP] Authenticating for document: ${documentName}`,
          {
            hasToken: !!token,
            tokenType: typeof token,
            tokenLength: token?.length,
            parameters: parameters ? Object.keys(parameters) : "none",
          },
        );
        const authStartTime = Date.now();

        // Log the authentication attempt
        logger.info("[HP-DIAG][HP] WebSocket connection attempt", {
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
          const safeStringify = (obj: any, space = 2) => {
            const seen = new WeakSet();
            return JSON.stringify(
              obj,
              (key, val) => {
                if (val != null && typeof val == "object") {
                  if (seen.has(val)) return "[Circular]";
                  seen.add(val);
                }
                return val;
              },
              space,
            );
          };

          logger.info("Full authentication data received", {
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

          logger.info("Detailed data inspection", {
            hasTokenDirectly: !!token,
            hasTokenInParameters: !!(parameters && parameters.token),
            hasTokenInConnection: !!(data as any).connection?.token,
            hasTokenInData: !!(data as any).token,
            hasTokenInAuth: !!(data as any).auth?.token,
            hasTokenInConnectionParameters: !!(data as any).connectionParameters
              ?.token,
            documentNameContainsQuery: documentName?.includes("?"),
            documentNameQueryParams: documentName?.split("?")[1],
          });

          logger.info("Raw data structure inspection", {
            dataKeys: Object.keys(data),
            hasConnection: !!(data as any).connection,
            connectionType: (data as any).connection
              ? typeof (data as any).connection
              : null,
            hasRequest: !!(data as any).request,
            requestType: (data as any).request
              ? typeof (data as any).request
              : null,
            hasInstance: !!(data as any).instance,
            instanceType: (data as any).instance
              ? typeof (data as any).instance
              : null,
          });

          logger.debug("Raw authentication data", {
            rawDataKeys: Object.keys(data),
            rawParameters: parameters,
            rawToken: token,
          });

          // Try to extract the token from various possible locations
          let authToken = token;
          if (!authToken && parameters && parameters.token) {
            authToken = parameters.token;
          }
          if (!authToken && (data as any).token) {
            authToken = (data as any).token;
          }
          if (!authToken && (data as any).connection?.token) {
            authToken = (data as any).connection.token;
          }
          if (!authToken && (data as any).connectionParameters?.token) {
            authToken = (data as any).connectionParameters.token;
          }
          if (!authToken && (data as any).auth?.token) {
            authToken = (data as any).auth.token;
          }

          // Try to extract token from documentName as query parameter
          if (!authToken) {
            try {
              const parts = documentName.split("?");
              logger.debug("Document name parts for token extraction", {
                parts: parts,
                partsLength: parts.length,
              });

              if (parts.length > 1) {
                const urlParams = new URLSearchParams(parts[1]);
                const urlToken = urlParams.get("token");

                logger.debug("URL token extraction result", {
                  hasUrlToken: !!urlToken,
                  urlTokenPreview: urlToken ? urlToken.substring(0, 10) : null,
                });

                if (urlToken) {
                  authToken = urlToken;
                }
              }
            } catch (urlError) {
              logger.debug("Could not parse token from URL", {
                error: urlError,
              });
            }
          }

          // Final attempt to extract token from documentName as URL
          if (!authToken) {
            try {
              let documentUrl;
              if (
                documentName.startsWith("http") ||
                documentName.startsWith("ws")
              ) {
                documentUrl = new URL(documentName);
              } else {
                documentUrl = new URL(`http://localhost/${documentName}`);
              }
              const urlToken = documentUrl.searchParams.get("token");

              logger.debug("Final token extraction attempt", {
                hasUrlToken: !!urlToken,
                urlTokenPreview: urlToken ? urlToken.substring(0, 10) : null,
              });

              if (urlToken) {
                authToken = urlToken;
              }
            } catch (urlError) {
              logger.debug("Could not parse documentName as URL", {
                error: urlError,
                documentName: documentName,
              });
            }
          }

          if (authToken) {
            logger.info("Token found", {
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
            logger.warn("Authentication failed: No token provided", {
              documentName,
              tokenSources: {
                directToken: !!token,
                parametersToken: !!(parameters && parameters.token),
                dataToken: !!(data as any).token,
                connectionToken: !!(data as any).connection?.token,
                connectionParametersToken: !!(data as any).connectionParameters
                  ?.token,
                authToken: !!(data as any).auth?.token,
              },
              receivedData: {
                hasToken: !!token,
                hasParameters: !!parameters,
                parametersKeys: parameters ? Object.keys(parameters) : null,
                dataKeys: Object.keys(data),
              },
              timestamp: new Date().toISOString(),
            });

            logger.info("Sending AUTH_REQUIRED response to client");
            const authRequiredError = new Error(
              "AUTH_REQUIRED: No authentication token provided. Please ensure you are logged in and have a valid session.",
            );
            (authRequiredError as any).code = "AUTH_REQUIRED";
            (authRequiredError as any).reason = "AUTH_REQUIRED";
            throw authRequiredError;
          }

          let userRecord: any;
          try {
            logger.info("Using AuthService.supabase for token verification");

            const supabaseClient = await AuthService.supabase;

            logger.info("Attempting Supabase getUser verification", {
              tokenPreview: authToken
                ? `${authToken.substring(0, 10)}...`
                : "NONE",
              tokenLength: authToken?.length,
            });

            const result = await supabaseClient.auth.getUser(authToken);
            const { data: userData, error } = result;

            if (error || !userData?.user) {
              logger.warn("Authentication failed: Supabase Auth error", {
                documentName,
                error: error?.message,
                errorCode: error?.code,
                errorStatus: error?.status,
                tokenExpired: error?.message?.includes("token is expired"),
                timestamp: new Date().toISOString(),
              });

              if (
                error?.message &&
                (error.message.includes("token is expired") ||
                  error.message.includes("Invalid JWT") ||
                  error.code === "invalid_jwt")
              ) {
                logger.warn(
                  "Token expired or invalid, requesting client to refresh",
                  {
                    documentName,
                    userId: (result.data as any)?.user?.id || "unknown",
                    errorCode: error?.code,
                    errorStatus: error?.status,
                    timestamp: new Date().toISOString(),
                  },
                );

                const tokenExpiredError = new Error(
                  "TOKEN_EXPIRED: Authentication token has expired",
                );
                (tokenExpiredError as any).code = "TOKEN_EXPIRED";
                (tokenExpiredError as any).reason = "TOKEN_EXPIRED";
                throw tokenExpiredError;
              }

              throw new Error(
                `Authentication failed: ${error?.message || "Unknown error"}`,
              );
            }

            userRecord = userData.user;
          } catch (error) {
            logger.warn("Authentication failed: Supabase Auth error", {
              documentName,
              error: (error as Error).message,
              stack: (error as Error).stack,
              timestamp: new Date().toISOString(),
            });

            if (
              (error as Error).message &&
              ((error as Error).message.includes("token is expired") ||
                (error as Error).message.includes("Invalid JWT"))
            ) {
              logger.warn(
                "Token expired or invalid, requesting client to refresh",
                {
                  documentName,
                  userId: (error as any).userId || "unknown",
                  timestamp: new Date().toISOString(),
                },
              );

              const tokenExpiredError = new Error(
                "TOKEN_EXPIRED: Authentication token has expired",
              );
              (tokenExpiredError as any).code = "TOKEN_EXPIRED";
              (tokenExpiredError as any).reason = "TOKEN_EXPIRED";
              throw tokenExpiredError;
            }

            throw new Error(
              `Authentication failed: ${(error as Error).message}`,
            );
          }

          if (!userRecord) {
            logger.warn("Authentication failed: No user found", {
              documentName,
              timestamp: new Date().toISOString(),
            });
            throw new Error("Authentication failed: No user found");
          }

          // Extract project or workspace ID from document name
          const projectIdMatch = documentName.match(/^project-(.+)$/);
          const workspaceIdMatch = documentName.match(/^workspace-(.+)$/);

          if (!projectIdMatch && !workspaceIdMatch) {
            logger.warn("Invalid document name format", {
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
              const project = await prisma.project.findFirst({
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
                logger.warn("User access denied to project", {
                  documentName,
                  userId: userRecord.id,
                  projectId: authenticatedId,
                  timestamp: new Date().toISOString(),
                });
                throw new Error(
                  "Access denied: User does not have permission to access this document",
                );
              }
            } catch (dbError) {
              logger.error("Database error during project authentication", {
                documentName,
                userId: userRecord.id,
                error: (dbError as Error).message,
              });
              throw dbError;
            }
          } else if (workspaceIdMatch) {
            authenticatedId = workspaceIdMatch[1];
            type = "workspace";
            try {
              // Check if user is a member of the workspace
              const workspaceMember = await prisma.workspaceMember.findFirst({
                where: {
                  workspace_id: authenticatedId,
                  user_id: userRecord.id,
                },
              });

              if (!workspaceMember) {
                logger.warn("User access denied to workspace", {
                  documentName,
                  userId: userRecord.id,
                  workspaceId: authenticatedId,
                  timestamp: new Date().toISOString(),
                });
                throw new Error(
                  "Access denied: User is not a member of this workspace",
                );
              }
            } catch (dbError) {
              logger.error("Database error during workspace authentication", {
                documentName,
                userId: userRecord.id,
                error: (dbError as Error).message,
              });
              throw dbError;
            }
          }

          const authDuration = Date.now() - authStartTime;
          const serverSessionId = randomUUID();
          const socketId = (data as any).connection?.socketId || (data as any).socketId || null;

          logger.info("[HP] User authenticated successfully", {
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
              await prisma.authorshipCollaborationSession.create({
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
            } catch (sessionError) {
              logger.warn("Failed to create authorship collaboration session", {
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
            name:
              userRecord.user_metadata?.full_name ||
              userRecord.email?.split("@")[0] ||
              "User",
            email: userRecord.email,
            serverSessionId,
            clientSessionId: parameters?.sessionId || null,
          };
        } catch (error) {
          logger.error("Authentication error", {
            documentName,
            error: (error as Error).message,
            stack: (error as Error).stack,
            timestamp: new Date().toISOString(),
          });
          throw error;
        }
      },

      async onDisconnect(data: onDisconnectPayload) {
        const { documentName, socketId, context } = data;
        const disconnectContext = (context || {}) as {
          id?: string;
          serverSessionId?: string;
          clientSessionId?: string;
        };
        logger.info("Client disconnected", {
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
                await prisma.$transaction([
                  prisma.collaboratorPresence.update({
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
                  prisma.authorshipCollaborationSession.updateMany({
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

                logger.info("User marked as offline in presence database", {
                  project_id: projectId,
                  user_id: userId,
                  timestamp: new Date().toISOString(),
                });
              } catch (presenceError) {
                logger.error("Error updating user presence on disconnect:", {
                  error: (presenceError as Error).message,
                  project_id: projectId,
                  user_id: userId,
                  timestamp: new Date().toISOString(),
                });
              }
            }
          } catch (error) {
            logger.error("Error marking user as offline in presence system:", {
              error,
              documentName,
              socketId,
            });
          }
        }
      },

      async onAwarenessUpdate(data: onAwarenessUpdatePayload) {
        const { documentName, added, updated, removed } = data;
        logger.debug("Awareness updated", {
          documentName,
          added,
          updated,
          removed,
          timestamp: new Date().toISOString(),
        });
      },
    });
  }

  async start(): Promise<void> {
    try {
      await this.server.listen();
      logger.info(`Hocuspocus server started on port ${this.port}`, {
        port: this.port,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Failed to start Hocuspocus server", {
        error: (error as Error).message,
        stack: (error as Error).stack,
        port: this.port,
        timestamp: new Date().toISOString(),
      });
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      await this.server.destroy();
      logger.info("Hocuspocus server stopped", {
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Error stopping Hocuspocus server", {
        error: (error as Error).message,
        stack: (error as Error).stack,
        timestamp: new Date().toISOString(),
      });
    }
  }

  public handleUpgrade(request: any, socket: any, head: any) {
    const url = request.url;
    logger.info(`[HP-DIAG][HP] handleUpgrade called for URL: ${url}`, {
      headers: request.headers,
      socketWritable: socket.writable,
      socketReadable: socket.readable,
      headLength: head?.length,
    });

    socket.on("error", (err: any) => {
      logger.error(
        `[HP-DIAG][HP] Socket Error during upgrade for ${url}:`,
        err,
      );
    });

    try {
      this.wss.handleUpgrade(request, socket, head, (ws: any) => {
        logger.info(
          `[HP-DIAG][HP] WebSocket upgrade successful for URL: ${request.url}`,
        );

        // Add raw listeners to debug silent failures
        ws.on("message", (msg: any) => {
          logger.info(`[HP-DIAG] Raw WS message received: ${msg.length} bytes`);
        });
        ws.on("close", (code: number, reason: Buffer) => {
          logger.info(
            `[HP-DIAG] Raw WS closed: ${code} ${reason?.toString() || ""}`,
          );
        });

        // Use any to bypass TS error for handleConnection parameters if needed
        (this.server as any).handleConnection(ws, request, {});
      });
    } catch (err) {
      logger.error(`[HP-DIAG][HP] Exception in handleUpgrade for ${url}:`, err);
      socket.destroy();
    }
  }

  getServerInstance() {
    return this.server;
  }

  private queueAuthorshipUpdate(update: QueuedAuthorshipUpdate) {
    const queueKey = `${update.projectId}:${update.context.id}:${update.context.serverSessionId}`;
    this.updateQueue.set(queueKey, update);

    if (this.updateQueueTimer) {
      clearTimeout(this.updateQueueTimer);
    }

    this.updateQueueTimer = setTimeout(() => {
      void this.processUpdateQueue();
    }, 5000);
  }

  private hashYjsDocument(document: Y.Doc): string {
    const stateVector = Y.encodeStateVector(document);
    return createHash("sha256")
      .update(Buffer.from(stateVector))
      .digest("hex");
  }

  private async processUpdateQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      const queuedUpdates = Array.from(this.updateQueue.values());
      this.updateQueue.clear();
      this.updateQueueTimer = null;

      for (const updateData of queuedUpdates) {
        try {
          logger.debug("Processing queued update", {
            projectId: updateData.projectId,
            timestamp: updateData.receivedAt.toISOString(),
          });

          const document = await this.server.documents.get(updateData.projectId);
          if (!document) {
            logger.warn("Skipping authorship update evidence: document not loaded", {
              projectId: updateData.projectId,
            });
            continue;
          }

          const updateHash = this.hashYjsDocument(document);
          await AuthorshipEvidenceService.recordServerObservedEdit({
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
        } catch (error) {
          logger.error("Error recording authorship update evidence", {
            projectId: updateData.projectId,
            userId: updateData.context.id,
            error: (error as Error).message,
            timestamp: new Date().toISOString(),
          });
        }
      }
    } catch (error) {
      logger.error("Error processing update queue", {
        error: (error as Error).message,
        stack: (error as Error).stack,
        timestamp: new Date().toISOString(),
      });
    } finally {
      this.isProcessingQueue = false;
    }
  }
}
