"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FeatureRequestService = void 0;
const prisma_1 = require("../lib/prisma");
const logger_1 = __importDefault(require("../monitoring/logger"));
const emailService_1 = require("./emailService");
const secrets_service_1 = __importDefault(require("./secrets-service"));
class FeatureRequestService {
    // Create a new feature request
    static async createFeatureRequest(requestData) {
        try {
            const request = await prisma_1.prisma.featureRequest.create({
                data: {
                    user_id: requestData.user_id || undefined,
                    title: requestData.title,
                    description: requestData.description,
                    category: requestData.category,
                    priority: requestData.priority,
                    status: "open",
                    votes: 1, // New requests start with 1 vote
                },
            });
            // Log the action
            await this.logRequestAction(request.user_id, "feature_request_created", request.id, "FeatureRequest", {
                title: request.title,
                category: request.category,
            });
            // Notify feature team
            await this.notifyFeatureTeam(`New Feature Request: ${request.title}`, `A new feature request has been submitted: "${request.title}" in category ${request.category}`);
            return request;
        }
        catch (error) {
            logger_1.default.error("Error creating feature request:", error);
            throw new Error("Failed to create feature request");
        }
    }
    // Get all feature requests
    static async getFeatureRequests(filters, limit = 50) {
        try {
            const whereClause = {};
            if (filters) {
                if (filters.category)
                    whereClause.category = filters.category;
                if (filters.status)
                    whereClause.status = filters.status;
                if (filters.priority)
                    whereClause.priority = filters.priority;
            }
            return await prisma_1.prisma.featureRequest.findMany({
                where: whereClause,
                orderBy: [
                    { votes: "desc" }, // Sort by votes first
                    { created_at: "desc" }, // Then by creation date
                ],
                take: limit,
            });
        }
        catch (error) {
            logger_1.default.error("Error fetching feature requests:", error);
            throw new Error("Failed to fetch feature requests");
        }
    }
    // Get a specific feature request
    static async getFeatureRequestById(id) {
        try {
            return await prisma_1.prisma.featureRequest.findUnique({
                where: {
                    id,
                },
            });
        }
        catch (error) {
            logger_1.default.error("Error fetching feature request by ID:", error);
            throw new Error("Failed to fetch feature request");
        }
    }
    // Vote for a feature request
    static async voteForFeature(featureId, userId) {
        try {
            // Check if user has already voted for this feature
            if (userId) {
                const existingVote = await prisma_1.prisma.featureVote.findUnique({
                    where: {
                        user_id_feature_id: {
                            user_id: userId,
                            feature_id: featureId,
                        },
                    },
                });
                if (existingVote) {
                    throw new Error("User has already voted for this feature");
                }
            }
            // Update the feature request vote count
            const updatedRequest = await prisma_1.prisma.featureRequest.update({
                where: {
                    id: featureId,
                },
                data: {
                    votes: {
                        increment: 1,
                    },
                },
            });
            // Record the vote if user is authenticated
            if (userId) {
                await prisma_1.prisma.featureVote.create({
                    data: {
                        user_id: userId,
                        feature_id: featureId,
                    },
                });
            }
            // Log the action
            await this.logRequestAction(userId || null, "feature_vote_added", featureId, "FeatureRequest", {
                votes: updatedRequest.votes,
            });
            return updatedRequest;
        }
        catch (error) {
            logger_1.default.error("Error voting for feature:", error);
            throw new Error("Failed to vote for feature");
        }
    }
    // Update feature request status
    static async updateFeatureStatus(userId, featureId, status) {
        try {
            // Check if user is admin
            const isAdmin = await this.isUserAdmin(userId);
            if (!isAdmin) {
                throw new Error("Only administrators can update feature status");
            }
            const updatedRequest = await prisma_1.prisma.featureRequest.update({
                where: {
                    id: featureId,
                },
                data: {
                    status,
                    implemented_at: status === "implemented" ? new Date() : undefined,
                },
            });
            // Log the action
            await this.logRequestAction(userId, `feature_${status}`, featureId, "FeatureRequest", {
                status,
            });
            // Notify the user who requested the feature if they provided an email
            if (updatedRequest.user_id) {
                const user = await prisma_1.prisma.user.findUnique({
                    where: {
                        id: updatedRequest.user_id,
                    },
                });
                if (user) {
                    let subject, message;
                    if (status === "implemented") {
                        subject = "Your Feature Request Has Been Implemented";
                        message = `Great news! Your feature request "${updatedRequest.title}" has been implemented.`;
                    }
                    else if (status === "in_progress") {
                        subject = "Your Feature Request Is Being Worked On";
                        message = `Your feature request "${updatedRequest.title}" is currently being worked on.`;
                    }
                    else if (status === "closed") {
                        subject = "Your Feature Request Has Been Closed";
                        message = `Your feature request "${updatedRequest.title}" has been closed. If you have any further questions, please let us know.`;
                    }
                    if (subject && message) {
                        await emailService_1.EmailService.sendNotificationEmail(user.email, user.full_name || "User", subject, message, "feature");
                    }
                }
            }
            return updatedRequest;
        }
        catch (error) {
            logger_1.default.error("Error updating feature status:", error);
            throw new Error("Failed to update feature status");
        }
    }
    // Check if user is admin
    static async isUserAdmin(userId) {
        try {
            // Check if user has admin role
            const user = await prisma_1.prisma.user.findUnique({
                where: {
                    id: userId,
                },
                select: {
                    user_role: true,
                    email: true,
                },
            });
            // Check if user has admin role
            if (user && user.user_role === "admin") {
                return true;
            }
            // Check if user is in the feature team
            if (user &&
                (user.user_role === "feature" || user.email.endsWith("@colabwize.com"))) {
                return true;
            }
            // Check specific admin user IDs from environment variables
            const adminUserIds = await secrets_service_1.default.getAdminUserIds();
            if (adminUserIds.includes(userId)) {
                return true;
            }
            return false;
        }
        catch (error) {
            logger_1.default.error("Error checking admin status:", error);
            return false;
        }
    }
    // Log request action for audit purposes
    static async logRequestAction(userId, action, resourceId, resourceType, details) {
        try {
            // Create a dedicated request audit log entry
            await prisma_1.prisma.auditLog.create({
                data: {
                    user_id: userId || undefined,
                    action,
                    resource_id: resourceId || undefined,
                    resource_type: resourceType || undefined,
                    details: details ? JSON.stringify(details) : undefined,
                    ip_address: details?.ipAddress || undefined,
                    user_agent: details?.userAgent || undefined,
                },
            });
        }
        catch (error) {
            logger_1.default.error("Error logging request action:", error);
            // Don't throw error as this is just for logging
        }
    }
    // Notify feature team via Discord webhook
    static async notifyFeatureTeam(subject, message) {
        try {
            // Discord webhook URL for feature team notifications
            const webhookUrl = "https://discord.com/api/webhooks/1445349012785074317/tVR9cz3trTXBLU3aThYV1gMcZJ8v0gLX65192h0x0986EaqzZzDpVs4R2AvT9Tt3mtUm";
            // Create embed for Discord message
            const embed = {
                title: "✨ Feature Team Notification",
                description: subject,
                color: 3447003, // Blue color
                fields: [
                    {
                        name: "📝 Message",
                        value: message.length > 1024
                            ? message.substring(0, 1021) + "..."
                            : message,
                        inline: false,
                    },
                ],
                timestamp: new Date().toISOString(),
                footer: {
                    text: "ColabWize Feature Request System",
                },
            };
            // Send POST request to Discord webhook
            const response = await fetch(webhookUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    content: "<@&feature-team> New feature request!",
                    embeds: [embed],
                }),
            });
            if (!response.ok) {
                throw new Error(`Discord webhook request failed with status ${response.status}`);
            }
            logger_1.default.info("Feature team notified via Discord webhook", {
                subject,
                message,
            });
        }
        catch (error) {
            logger_1.default.error("Error notifying feature team via Discord webhook:", error);
            // Fallback to email notification if Discord fails
            try {
                const featureEmail = await secrets_service_1.default.getContactAdminEmail();
                await emailService_1.EmailService.sendNotificationEmail(featureEmail, "Feature Team", subject, message, "feature");
            }
            catch (emailError) {
                logger_1.default.error("Error sending fallback email notification:", emailError);
            }
        }
    }
}
exports.FeatureRequestService = FeatureRequestService;
