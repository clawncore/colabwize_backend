import {
  Hocuspocus,
  onLoadDocumentPayload,
  onStoreDocumentPayload,
  onDisconnectPayload,
  onAwarenessUpdatePayload,
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

// Cache to store content hashes to avoid unnecessary database writes
const lastStoredContentHashes = new Map<string, string>();

export class HocuspocusCollaborationServer {
  private server: Hocuspocus;
  private wss: WebSocketServer;
  private port: number;
  private updateQueue = new Map<string, any>();
  private isProcessingQueue = false;

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
      debounce: 1000,
      maxDebounce: 5000,
      timeout: 30000,
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
            select: { content: true },
          });

          // Define extensions locally for the static context if needed,
          // or use instance bound method if Hocuspocus allows it (which it does via constructor closure)
          const extensions = self.getExtensions();

          if (project && project.content) {
            let content = project.content;

            // Handle legacy HTML content (common in uploaded documents)
            if (typeof content === "string") {
              logger.info(
                `[HP] Document ${projectId} content is HTML, generating JSON...`,
              );
              try {
                content = generateJSON(content, extensions);
                logger.info(
                  `[HP] Successfully transformed HTML to JSON for document ${projectId}`,
                );
              } catch (convError) {
                logger.error(
                  `[HP] Failed to convert HTML to JSON for ${projectId}:`,
                  convError,
                );
                // Fallback to empty doc if conversion fails
                content = { type: "doc", content: [{ type: "paragraph" }] };
              }
            }

            const duration = Date.now() - startTime;
            logger.info(
              `[HP] Document ${projectId} loaded and transformed in ${duration}ms`,
              {
                contentSize: JSON.stringify(content).length,
              },
            );
            return TiptapTransformer.extensions(extensions as any).toYdoc(
              content,
              "default",
            );
          } else if (project) {
            logger.info(
              `Project ${projectId} exists but content is empty, returning default structure`,
            );
            // Return empty project structure if project exists but content is null
            return TiptapTransformer.extensions(extensions as any).toYdoc(
              { type: "doc", content: [{ type: "paragraph" }] },
              "default",
            );
          } else {
            logger.warn(`Project ${projectId} not found in database`);
          }
        } catch (error) {
          logger.error(`Failed to load document ${projectId}:`, error);
        }
        return null;
      },
      async onStoreDocument(data: onStoreDocumentPayload) {
        const { document, documentName } = data;
        try {
          if (!documentName.startsWith("project-")) return;
          const projectId = documentName.replace("project-", "");

          // Use TiptapTransformer to correctly serialize Yjs document to Tiptap JSON
          const extensions = self.getExtensions();
          const content = TiptapTransformer.extensions(
            extensions as any,
          ).fromYdoc(document, "default");

          logger.info(`Attempting to store document ${projectId}`, {
            documentName,
            contentSize: content ? JSON.stringify(content).length : 0,
            timestamp: new Date().toISOString(),
          });

          if (!content || (content as any).content?.length === 0) {
            logger.warn(
              "Attempted to store empty or invalid document, skipping",
              { projectId },
            );
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
            logger.info("Document content unchanged, skipping store", {
              projectId,
              timestamp: new Date().toISOString(),
            });
            return;
          }

          lastStoredContentHashes.set(projectId, contentHash);

          logger.info(`Starting database transaction for ${projectId}`);

          // Use a database transaction to ensure consistency
          // Increased timeout to 30s to handle database latency spikes
          await prisma.$transaction(
            async (tx: any) => {
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
                logger.warn(
                  "Parallel save detected in onStoreDocument - Hocuspocus overwriting",
                  {
                    projectId,
                    timestamp: new Date().toISOString(),
                  },
                );
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
            },
            {
              timeout: 30000, // 30 seconds
            },
          );

          logger.info("Document stored in database (no version created)", {
            projectId,
            timestamp: new Date().toISOString(),
            message: "Frequent save for CRDT protection, not versioning",
          });
        } catch (error) {
          logger.error("Error storing document:", {
            error: (error as Error).message || error,
            stack: (error as Error).stack,
            documentName,
            timestamp: new Date().toISOString(),
          });
        }
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
          logger.info("[HP] User authenticated successfully", {
            documentName,
            userId: userRecord.id,
            userEmail: userRecord.email,
            id: authenticatedId,
            type,
            duration_ms: authDuration,
            timestamp: new Date().toISOString(),
          });

          // Return user information for the WebSocket connection
          return {
            id: userRecord.id,
            name:
              userRecord.user_metadata?.full_name ||
              userRecord.email?.split("@")[0] ||
              "User",
            email: userRecord.email,
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
        logger.info("Client disconnected", {
          documentName,
          socketId,
          timestamp: new Date().toISOString(),
        });

        // Only handle project-specific presence cleanup
        if (documentName.startsWith("project-")) {
          try {
            const projectId = documentName.replace("project-", "");
            const userId = (context as any)?.user?.id;
            if (projectId && userId) {
              // Update user presence to offline in the database
              try {
                await prisma.collaboratorPresence.update({
                  where: {
                    project_id_user_id: {
                      project_id: projectId,
                      user_id: userId,
                    },
                  },
                  data: {
                    last_active_at: new Date(),
                  },
                });

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

  private async processUpdateQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      for (const [projectId, updateData] of this.updateQueue.entries()) {
        logger.debug("Processing queued update", {
          projectId,
          timestamp: new Date().toISOString(),
        });
      }
      this.updateQueue.clear();
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
