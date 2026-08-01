"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNotificationServer = getNotificationServer;
exports.closeNotificationServer = closeNotificationServer;
const notification_server_1 = require("../hybrid/websockets/notification-server");
// Singleton instance of NotificationServer
let notificationServer = null;
function getNotificationServer() {
    if (!notificationServer) {
        // Create notification server on port 8082
        notificationServer = new notification_server_1.NotificationServer(8082);
    }
    return notificationServer;
}
function closeNotificationServer() {
    if (notificationServer) {
        notificationServer.close();
        notificationServer = null;
    }
}
