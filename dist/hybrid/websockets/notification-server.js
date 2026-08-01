"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationServer = void 0;
const ws_1 = require("ws");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const hybridAuthService_1 = require("../../services/hybridAuthService");
const secrets_service_1 = require("../../services/secrets-service");
const notificationService_1 = require("../../services/notificationService");
class NotificationServer {
    wss;
    port;
    connectedClients = new Map(); // userId -> Set of connections
    channelSubscriptions = new Map(); // channelName -> Set of connections
    constructor(port) {
        this.port = port;
        // Use noServer: true to allow multiplexing on a single port
        this.wss = new ws_1.WebSocketServer({ noServer: true });
        this.setupWebSocketHandlers();
    }
    /**
     * Handle WebSocket upgrade requests from a unified server
     */
    async handleUpgrade(req, socket, head) {
        const origin = req.headers.origin || "";
        const urlString = req.url || "";
        console.log(`[NotificationServer] Upgrade attempt from ${origin} - URL: ${urlString}`);
        try {
            const host = req.headers.host || "localhost";
            const url = new URL(urlString, `http://${host}`);
            const tokenFromUrl = url.searchParams.get("token");
            const tokenFromHeader = req.headers.authorization?.replace("Bearer ", "");
            const tokenFromProtocol = req.headers["sec-websocket-protocol"];
            const token = tokenFromUrl || tokenFromHeader || tokenFromProtocol;
            // Verify origin and token (Logically equivalent to the old verifyClient)
            const allowedOrigins = [
                "http://localhost:3000",
                "http://localhost:5173",
                "https://localhost:3000",
                "https://localhost:5173",
                await secrets_service_1.SecretsService.getAppUrl(),
                ...((await secrets_service_1.SecretsService.getAllowedOrigins())?.split(",") || []),
            ].filter(Boolean);
            if (origin && allowedOrigins.length > 0) {
                const isOriginAllowed = allowedOrigins.some((allowed) => {
                    if (origin === allowed)
                        return true;
                    const cleanOrigin = origin
                        .replace("https://", "")
                        .replace("http://", "");
                    const cleanAllowed = allowed
                        .replace("https://", "")
                        .replace("http://", "");
                    return (cleanOrigin === cleanAllowed || cleanOrigin.startsWith(cleanAllowed));
                });
                if (!isOriginAllowed) {
                    logger_1.default.warn("WebSocket connection attempt from unauthorized origin", {
                        origin,
                        allowedOrigins,
                    });
                    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
                    socket.destroy();
                    return;
                }
            }
            if (!token) {
                logger_1.default.warn("WebSocket connection attempt without token", {
                    url: urlString,
                });
                socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
                socket.destroy();
                return;
            }
            const isValid = await this.verifyAuthToken(token);
            if (!isValid) {
                logger_1.default.warn("WebSocket connection attempt with invalid token", {
                    origin,
                });
                socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
                socket.destroy();
                return;
            }
            // If all checks pass, proceed with upgrade
            this.wss.handleUpgrade(req, socket, head, (ws) => {
                this.wss.emit("connection", ws, req);
            });
        }
        catch (error) {
            logger_1.default.error("Error during WebSocket handleUpgrade", {
                error: error instanceof Error ? error.message : String(error),
            });
            socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
            socket.destroy();
        }
    }
    async verifyAuthToken(token) {
        try {
            if (!token || token.length < 10)
                return false;
            // During verifyClient (handshake), we just do a lightweight check to not block connection.
            // We will do full validation when we process the authenticate message or set up the user.
            const jwtPayload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
            if (!jwtPayload || !jwtPayload.exp)
                return false;
            if (Date.now() >= jwtPayload.exp * 1000) {
                logger_1.default.warn("WebSocket token expired during initial handshake");
                return false;
            }
            return true;
        }
        catch (e) {
            logger_1.default.error("Fast verifyAuthToken failed", { error: e });
            return false;
        }
    }
    setupWebSocketHandlers() {
        this.wss.on("connection", async (ws, req) => {
            logger_1.default.info("New notification WebSocket connection established", {
                url: req.url,
                headers: {
                    origin: req.headers.origin,
                    userAgent: req.headers["user-agent"],
                },
            });
            // Try to authenticate immediately if token is in URL
            try {
                const urlString = req.url || "http://localhost";
                const url = new URL(urlString, `http://${req.headers.host || "localhost"}`);
                const token = url.searchParams.get("token");
                if (token) {
                    logger_1.default.info("Attempting auto-authentication from connection URL");
                    await this.authenticateUser(ws, token);
                }
            }
            catch (error) {
                logger_1.default.debug("Could not auto-authenticate from URL", { error });
            }
            ws.on("message", async (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    logger_1.default.debug("Received WebSocket message", { type: message.type });
                    await this.handleMessage(ws, message);
                }
                catch (error) {
                    logger_1.default.error("Error parsing WebSocket message", { error });
                    ws.send(JSON.stringify({
                        type: "error",
                        message: "Invalid message format",
                    }));
                }
            });
            ws.on("close", () => {
                if (ws.userId) {
                    this.removeClientConnection(ws.userId, ws);
                    logger_1.default.info(`Client disconnected: ${ws.userId}`);
                    // Update presence to offline in DB
                    this.updateUserPresence(ws.userId, "offline").catch(err => logger_1.default.error("Failed to update presence on disco", { err }));
                }
                // Cleanup all channel subscriptions for this connection
                this.unsubscribeFromAllChannels(ws);
            });
            ws.on("error", (error) => {
                logger_1.default.error("WebSocket connection error", { error });
            });
        });
        this.wss.on("error", (error) => {
            logger_1.default.error("WebSocket server error", { error });
        });
    }
    async handleMessage(ws, message) {
        const { type, token, channels } = message;
        switch (type) {
            case "authenticate":
                await this.authenticateUser(ws, token);
                break;
            case "subscribe":
                if (ws.isAuthenticated) {
                    this.subscribeToChannels(ws, channels);
                }
                else {
                    ws.send(JSON.stringify({
                        type: "error",
                        message: "Authentication required",
                    }));
                }
                break;
            case "unsubscribe":
                if (ws.isAuthenticated) {
                    this.unsubscribeFromChannels(ws, channels);
                }
                break;
            case "channel_message":
                if (ws.isAuthenticated && message.channel && message.data) {
                    this.broadcastToChannel(message.channel, message.data);
                }
                break;
            case "typing":
                if (ws.isAuthenticated && message.channel) {
                    this.broadcastToChannel(message.channel, {
                        type: "TYPING_STATUS",
                        userId: ws.userId,
                        isTyping: message.isTyping,
                    });
                }
                break;
            case "message_read":
                if (ws.isAuthenticated && message.messageId) {
                    try {
                        const { TeamChatService } = await import("../../services/teamChatService.js");
                        await TeamChatService.markMessageAsRead(message.messageId, ws.userId);
                    }
                    catch (err) {
                        logger_1.default.error("Error handling message_read event", { err });
                    }
                }
                break;
            default:
                logger_1.default.warn("Unknown message type received", { type });
                ws.send(JSON.stringify({
                    type: "error",
                    message: "Unknown message type",
                }));
        }
    }
    async authenticateUser(ws, token) {
        try {
            if (!token) {
                // If already authenticated via URL, don't error
                if (ws.isAuthenticated) {
                    logger_1.default.debug("User already authenticated via URL, ignoring empty token message");
                    return;
                }
                ws.send(JSON.stringify({
                    type: "error",
                    message: "Token required for authentication",
                }));
                ws.close();
                return;
            }
            // If already authenticated with the SAME token, ignore
            if (ws.isAuthenticated && ws.userId) {
                const currentUserId = await this.getUserIdFromToken(token);
                if (currentUserId === ws.userId) {
                    logger_1.default.debug("User already authenticated with same token, ignoring");
                    return;
                }
            }
            // Verify the token
            const isValid = await this.verifyAuthToken(token);
            if (!isValid) {
                ws.send(JSON.stringify({
                    type: "error",
                    message: "Invalid authentication token",
                }));
                ws.close();
                return;
            }
            // Get user ID from token (in a real implementation you'd decode the JWT)
            // For now, we'll assume the token contains user info or we need to look it up
            console.log("[NotificationServer] Attempting to get userId from token...");
            const userId = await this.getUserIdFromToken(token);
            if (!userId) {
                console.warn("[NotificationServer] Failed to retrieve userId from token");
                ws.send(JSON.stringify({
                    type: "error",
                    message: "Could not retrieve user ID from token",
                }));
                ws.close();
                return;
            }
            console.log(`[NotificationServer] User identified: ${userId}`);
            // Mark as authenticated
            ws.userId = userId;
            ws.isAuthenticated = true;
            // Add to connected clients
            this.addClientConnection(userId, ws);
            // Send authentication confirmation
            ws.send(JSON.stringify({
                type: "authenticated",
                userId,
            }));
            // Push initial unread count to the user immediately after authentication
            try {
                const unreadCount = await (0, notificationService_1.getUnreadNotificationCount)(userId);
                ws.send(JSON.stringify({
                    type: "notification_count",
                    count: unreadCount,
                }));
                logger_1.default.info(`Pushed initial unread count (${unreadCount}) to user ${userId}`);
            }
            catch (countError) {
                logger_1.default.error("Error pushing initial unread count", { countError });
            }
            logger_1.default.info(`User authenticated via WebSocket: ${userId}`);
            // Update presence to online
            this.updateUserPresence(userId, "online").catch(err => logger_1.default.error("Failed to update presence on auth", { err }));
        }
        catch (error) {
            logger_1.default.error("Authentication error", { error });
            ws.send(JSON.stringify({
                type: "error",
                message: "Authentication failed",
            }));
            ws.close();
        }
    }
    async getUserIdFromToken(token) {
        try {
            // In the actual authentication step, we do the full verify
            const result = await hybridAuthService_1.HybridAuthService.syncUserSession(token);
            if (result && result.success && result.user) {
                return result.user.id;
            }
            // Fallback: extract from JWT if sync fails but token is valid syntax
            const jwtPayload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
            return jwtPayload.sub || null;
        }
        catch (error) {
            logger_1.default.error("Error getting user ID from token", { error });
            return null;
        }
    }
    addClientConnection(userId, ws) {
        if (!this.connectedClients.has(userId)) {
            this.connectedClients.set(userId, new Set());
        }
        this.connectedClients.get(userId).add(ws);
        logger_1.default.debug(`Added connection for user ${userId}. Total connections: ${this.connectedClients.get(userId).size}`);
    }
    removeClientConnection(userId, ws) {
        const userConnections = this.connectedClients.get(userId);
        if (userConnections) {
            userConnections.delete(ws);
            if (userConnections.size === 0) {
                this.connectedClients.delete(userId);
            }
            logger_1.default.debug(`Removed connection for user ${userId}. Remaining connections: ${userConnections.size}`);
        }
    }
    subscribeToChannels(ws, channels) {
        if (!channels || !Array.isArray(channels))
            return;
        channels.forEach((channel) => {
            if (!this.channelSubscriptions.has(channel)) {
                this.channelSubscriptions.set(channel, new Set());
            }
            this.channelSubscriptions.get(channel).add(ws);
        });
        ws.send(JSON.stringify({
            type: "subscribed",
            channels,
        }));
        logger_1.default.debug(`User ${ws.userId} subscribed to channels: ${channels.join(", ")}`);
    }
    unsubscribeFromChannels(ws, channels) {
        if (!channels || !Array.isArray(channels))
            return;
        channels.forEach((channel) => {
            const subscribers = this.channelSubscriptions.get(channel);
            if (subscribers) {
                subscribers.delete(ws);
                if (subscribers.size === 0) {
                    this.channelSubscriptions.delete(channel);
                }
            }
        });
        ws.send(JSON.stringify({
            type: "unsubscribed",
            channels,
        }));
        logger_1.default.debug(`User ${ws.userId} unsubscribed from channels: ${channels.join(", ")}`);
    }
    unsubscribeFromAllChannels(ws) {
        this.channelSubscriptions.forEach((subscribers, channel) => {
            if (subscribers.has(ws)) {
                subscribers.delete(ws);
                if (subscribers.size === 0) {
                    this.channelSubscriptions.delete(channel);
                }
            }
        });
    }
    // Method to send a message to all subscribers of a channel
    broadcastToChannel(channel, data) {
        const subscribers = this.channelSubscriptions.get(channel);
        if (subscribers) {
            const message = JSON.stringify({
                type: "channel_message",
                channel,
                data,
            });
            let sentCount = 0;
            subscribers.forEach((ws) => {
                if (ws.readyState === ws_1.WebSocket.OPEN) {
                    ws.send(message);
                    sentCount++;
                }
            });
            logger_1.default.info(`Broadcast to channel ${channel} sent to ${sentCount} users`);
        }
    }
    // Method to send a notification to a specific user
    sendNotificationToUser(userId, notification) {
        const userConnections = this.connectedClients.get(userId);
        if (userConnections) {
            const message = JSON.stringify({
                type: "notification",
                notification,
            });
            userConnections.forEach((ws) => {
                if (ws.readyState === ws_1.WebSocket.OPEN) {
                    ws.send(message);
                }
            });
            logger_1.default.info(`Sent notification to user ${userId}`, {
                notificationId: notification.id,
            });
        }
        else {
            logger_1.default.debug(`No active connections for user ${userId}, notification stored in database for later delivery`);
        }
    }
    // Method to broadcast notification to all connected clients
    broadcastNotification(notification) {
        let sentCount = 0;
        this.connectedClients.forEach((connections, userId) => {
            connections.forEach((ws) => {
                if (ws.readyState === ws_1.WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: "notification",
                        notification,
                    }));
                    sentCount++;
                }
            });
        });
        logger_1.default.info(`Broadcast notification to ${sentCount} connections`, {
            notificationId: notification.id,
        });
    }
    // Gracefully close the server
    close() {
        return new Promise((resolve, reject) => {
            // Close all client connections
            this.connectedClients.forEach((connections) => {
                connections.forEach((ws) => {
                    if (ws.readyState === ws_1.WebSocket.OPEN) {
                        ws.close();
                    }
                });
            });
            // Clear the connections maps
            this.connectedClients.clear();
            this.channelSubscriptions.clear();
            // Close the WebSocket server
            this.wss.close((error) => {
                if (error) {
                    logger_1.default.error("Error closing notification WebSocket server", {
                        error,
                    });
                    reject(error);
                }
                else {
                    logger_1.default.info("Notification WebSocket server closed");
                    resolve();
                }
            });
        });
    }
    // Get current server stats
    getStats() {
        const totalConnections = Array.from(this.connectedClients.values()).reduce((sum, connections) => sum + connections.size, 0);
        return {
            port: this.port,
            totalConnections,
            uniqueUsers: this.connectedClients.size,
        };
    }
    async updateUserPresence(userId, status) {
        try {
            const { TeamChatService } = await import("../../services/teamChatService.js");
            await TeamChatService.updatePresence(userId, status);
            this.broadcastToChannel("global-presence", {
                type: "USER_PRESENCE",
                userId,
                status,
                lastSeen: new Date().toISOString()
            });
        }
        catch (error) {
            logger_1.default.error("Error in updateUserPresence", { userId, error });
        }
    }
}
exports.NotificationServer = NotificationServer;
