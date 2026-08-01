"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const notificationSettingsService_1 = require("../../../../services/notificationSettingsService");
const client_1 = require("../../../../lib/supabase/client");
// POST /api/notifications/settings/reset - Reset user notification settings to defaults
async function POST(request) {
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
        // Reset notification settings to defaults
        const settings = await notificationSettingsService_1.NotificationSettingsService.resetUserNotificationSettings(userId);
        return new Response(JSON.stringify({
            success: true,
            message: "Notification settings reset to defaults successfully",
            settings,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    catch (error) {
        console.error("Error resetting notification settings:", error);
        return new Response(JSON.stringify({
            success: false,
            message: "Failed to reset notification settings",
        }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
}
