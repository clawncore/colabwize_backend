"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST_REGISTER = POST_REGISTER;
exports.POST_UNREGISTER = POST_UNREGISTER;
exports.POST_TEST = POST_TEST;
const pushNotificationService_1 = require("../../../services/pushNotificationService");
const client_1 = require("../../../lib/supabase/client");
// POST /api/notifications/push/register - Register a push notification token
async function POST_REGISTER(request) {
    try {
        // Get user session
        const supabaseClient = await (0, client_1.getSupabaseClient)();
        if (!supabaseClient) {
            return new Response(JSON.stringify({
                success: false,
                message: "Supabase client not initialized",
            }), { status: 500, headers: { "Content-Type": "application/json" } });
        }
        const { data: { session }, error: sessionError, } = await supabaseClient.auth.getSession();
        if (sessionError || !session || !session.user) {
            return new Response(JSON.stringify({ success: false, message: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
        }
        const userId = session.user.id;
        const body = await request.json();
        const { token } = body;
        if (!token) {
            return new Response(JSON.stringify({ success: false, message: "Token is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
        // Register the token
        await pushNotificationService_1.PushNotificationService.registerToken(userId, token);
        return new Response(JSON.stringify({
            success: true,
            message: "Push notification token registered successfully",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    catch (error) {
        console.error("Error registering push notification token:", error);
        return new Response(JSON.stringify({
            success: false,
            message: "Failed to register push notification token",
        }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
}
// POST /api/notifications/push/unregister - Unregister a push notification token
async function POST_UNREGISTER(request) {
    try {
        // Get user session
        const supabaseClient = await (0, client_1.getSupabaseClient)();
        if (!supabaseClient) {
            return new Response(JSON.stringify({
                success: false,
                message: "Supabase client not initialized",
            }), { status: 500, headers: { "Content-Type": "application/json" } });
        }
        const { data: { session }, error: sessionError, } = await supabaseClient.auth.getSession();
        if (sessionError || !session || !session.user) {
            return new Response(JSON.stringify({ success: false, message: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
        }
        const userId = session.user.id;
        const body = await request.json();
        const { token } = body;
        if (!token) {
            return new Response(JSON.stringify({ success: false, message: "Token is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
        // Unregister the token
        await pushNotificationService_1.PushNotificationService.unregisterToken(userId, token);
        return new Response(JSON.stringify({
            success: true,
            message: "Push notification token unregistered successfully",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    catch (error) {
        console.error("Error unregistering push notification token:", error);
        return new Response(JSON.stringify({
            success: false,
            message: "Failed to unregister push notification token",
        }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
}
// POST /api/notifications/push/test - Send a test push notification
async function POST_TEST(request) {
    try {
        // Get user session
        const supabaseClient = await (0, client_1.getSupabaseClient)();
        if (!supabaseClient) {
            return new Response(JSON.stringify({
                success: false,
                message: "Supabase client not initialized",
            }), { status: 500, headers: { "Content-Type": "application/json" } });
        }
        const { data: { session }, error: sessionError, } = await supabaseClient.auth.getSession();
        if (sessionError || !session || !session.user) {
            return new Response(JSON.stringify({ success: false, message: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
        }
        const userId = session.user.id;
        const body = await request.json();
        const { title, message, data } = body;
        // Send test push notification
        await pushNotificationService_1.PushNotificationService.sendToUser(userId, title || "Test Notification", message || "This is a test push notification", data);
        return new Response(JSON.stringify({
            success: true,
            message: "Test push notification sent successfully",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    catch (error) {
        console.error("Error sending test push notification:", error);
        return new Response(JSON.stringify({
            success: false,
            message: "Failed to send test push notification",
        }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
}
