"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DemoRequestService = void 0;
const prisma_1 = require("../lib/prisma");
const secrets_service_1 = require("./secrets-service");
class DemoRequestService {
    /**
     * Creates a new demo request in the database
     */
    static async createDemoRequest(data) {
        try {
            const demoRequest = await prisma_1.prisma.demoRequest.create({
                data: {
                    name: data.name,
                    email: data.email,
                    institution: data.institution,
                    role: data.role,
                    date: new Date(data.date),
                    time: data.time,
                    message: data.message || "",
                    ip_address: data.ip_address,
                    user_agent: data.user_agent,
                },
            });
            return demoRequest;
        }
        catch (error) {
            console.error("Error creating demo request:", error);
            throw new Error("Failed to create demo request");
        }
    }
    /**
     * Sends the demo request data to a Discord webhook
     */
    static async sendToDiscordWebhook(demoRequest) {
        try {
            const webhookUrl = (await secrets_service_1.SecretsService.getDemoWebhookUrl()) ||
                "https://discord.com/api/webhooks/1445342945568882769/nCaxkt3ZFn8nWYhrxvZ2zd9GK8JqAauIn_twGJTYAqHBWPuwHKIjasUGdui7BtXnecT";
            const webhookData = {
                content: null,
                embeds: [
                    {
                        title: "New Demo Request",
                        color: 33023,
                        fields: [
                            {
                                name: "Name",
                                value: demoRequest.name,
                                inline: true,
                            },
                            {
                                name: "Email",
                                value: demoRequest.email,
                                inline: true,
                            },
                            {
                                name: "Institution",
                                value: demoRequest.institution,
                                inline: true,
                            },
                            {
                                name: "Role",
                                value: demoRequest.role || "Not specified",
                                inline: true,
                            },
                            {
                                name: "Preferred Date",
                                value: new Date(demoRequest.date).toLocaleDateString(),
                                inline: true,
                            },
                            {
                                name: "Preferred Time",
                                value: this.formatTimeSlot(demoRequest.time),
                                inline: true,
                            },
                            {
                                name: "Message",
                                value: demoRequest.message || "No message provided",
                                inline: false,
                            },
                            {
                                name: "Submitted At",
                                value: new Date(demoRequest.created_at).toLocaleString(),
                                inline: false,
                            },
                        ],
                        footer: {
                            text: "ColabWize Demo Request",
                        },
                        timestamp: new Date().toISOString(),
                    },
                ],
                username: "ColabWize Bot",
                avatar_url: "https://colabwize.com/logo.png",
            };
            const response = await fetch(webhookUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(webhookData),
            });
            if (!response.ok) {
                throw new Error(`Discord webhook failed with status ${response.status}`);
            }
            return response;
        }
        catch (error) {
            console.error("Error sending to Discord webhook:", error);
            throw new Error("Failed to send demo request to Discord");
        }
    }
    /**
     * Formats the time slot for better display
     */
    static formatTimeSlot(timeSlot) {
        switch (timeSlot) {
            case "morning":
                return "Morning (9:00 AM - 12:00 PM)";
            case "afternoon":
                return "Afternoon (12:00 PM - 5:00 PM)";
            case "evening":
                return "Evening (5:00 PM - 8:00 PM)";
            default:
                return timeSlot;
        }
    }
    /**
     * Gets all demo requests (for admin purposes)
     */
    static async getAllDemoRequests() {
        try {
            const demoRequests = await prisma_1.prisma.demoRequest.findMany({
                orderBy: {
                    created_at: "desc",
                },
            });
            return demoRequests;
        }
        catch (error) {
            console.error("Error fetching demo requests:", error);
            throw new Error("Failed to fetch demo requests");
        }
    }
    /**
     * Gets a specific demo request by ID
     */
    static async getDemoRequestById(id) {
        try {
            const demoRequest = await prisma_1.prisma.demoRequest.findUnique({
                where: { id },
            });
            return demoRequest;
        }
        catch (error) {
            console.error("Error fetching demo request:", error);
            throw new Error("Failed to fetch demo request");
        }
    }
}
exports.DemoRequestService = DemoRequestService;
