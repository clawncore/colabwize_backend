"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.PUT = PUT;
const notificationService_1 = require("../../../services/notificationService");
const client_1 = require("../../../lib/supabase/client");
// GET /api/notifications/settings - Get user notification settings
async function GET(request) {
    try {
        // Get user from authorization header
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return new Response(JSON.stringify({ success: false, message: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
        }
        const token = authHeader.substring(7); // Remove "Bearer " prefix
        // Verify the token with Supabase
        const supabase = await (0, client_1.getSupabaseClient)();
        const { data: { user }, error: userError, } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return new Response(JSON.stringify({ success: false, message: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
        }
        const userId = user.id;
        // Get notification settings
        const settings = await (0, notificationService_1.getUserNotificationSettings)(userId);
        return new Response(JSON.stringify({ success: true, settings }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }
    catch (error) {
        console.error("Error fetching notification settings:", error);
        return new Response(JSON.stringify({
            success: false,
            message: "Failed to fetch notification settings",
        }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
}
// PUT /api/notifications/settings - Update user notification settings
async function PUT(request) {
    try {
        // Get user from authorization header
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return new Response(JSON.stringify({ success: false, message: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
        }
        const token = authHeader.substring(7); // Remove "Bearer " prefix
        // Verify the token with Supabase
        const supabase = await (0, client_1.getSupabaseClient)();
        const { data: { user }, error: userError, } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return new Response(JSON.stringify({ success: false, message: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
        }
        const userId = user.id;
        const body = await request.json();
        // Update notification settings
        const settings = await (0, notificationService_1.updateUserNotificationSettings)(userId, body);
        return new Response(JSON.stringify({
            success: true,
            message: "Notification settings updated successfully",
            settings,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    catch (error) {
        console.error("Error updating notification settings:", error);
        return new Response(JSON.stringify({
            success: false,
            message: "Failed to update notification settings",
        }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
}
