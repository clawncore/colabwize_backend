"use strict";
// Import all notification API handlers
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = exports.POST_SEND_TEST_NOTIFICATION = exports.POST_TEST_NOTIFICATION = exports.POST_BULK_SNOOZE = exports.POST_BULK_DISMISS = exports.POST_BULK_DELETE = exports.POST_BULK_READ = exports.POST_PUSH_TEST = exports.POST_PUSH_UNREGISTER = exports.POST_PUSH_REGISTER = exports.POST_NOTIFICATION_ACTIONS = exports.POST_NOTIFICATION_SETTINGS_RESET = exports.PUT_NOTIFICATION_SETTINGS = exports.GET_NOTIFICATION_SETTINGS = exports.POST_NOTIFICATIONS = exports.GET_NOTIFICATIONS = void 0;
// Main notification routes
var route_1 = require("./route");
Object.defineProperty(exports, "GET_NOTIFICATIONS", { enumerable: true, get: function () { return route_1.GET; } });
Object.defineProperty(exports, "POST_NOTIFICATIONS", { enumerable: true, get: function () { return route_1.POST; } });
// Notification settings routes
var route_2 = require("./settings/route");
Object.defineProperty(exports, "GET_NOTIFICATION_SETTINGS", { enumerable: true, get: function () { return route_2.GET; } });
Object.defineProperty(exports, "PUT_NOTIFICATION_SETTINGS", { enumerable: true, get: function () { return route_2.PUT; } });
// Notification settings reset route
var route_3 = require("./settings/reset/route");
Object.defineProperty(exports, "POST_NOTIFICATION_SETTINGS_RESET", { enumerable: true, get: function () { return route_3.POST; } });
// Notification actions routes
var route_4 = require("./actions/route");
Object.defineProperty(exports, "POST_NOTIFICATION_ACTIONS", { enumerable: true, get: function () { return route_4.POST; } });
// Notification push routes
var route_5 = require("./push/route");
Object.defineProperty(exports, "POST_PUSH_REGISTER", { enumerable: true, get: function () { return route_5.POST_REGISTER; } });
Object.defineProperty(exports, "POST_PUSH_UNREGISTER", { enumerable: true, get: function () { return route_5.POST_UNREGISTER; } });
Object.defineProperty(exports, "POST_PUSH_TEST", { enumerable: true, get: function () { return route_5.POST_TEST; } });
// Notification bulk operations routes
var route_6 = require("./bulk/route");
Object.defineProperty(exports, "POST_BULK_READ", { enumerable: true, get: function () { return route_6.POST_READ; } });
Object.defineProperty(exports, "POST_BULK_DELETE", { enumerable: true, get: function () { return route_6.POST_DELETE; } });
Object.defineProperty(exports, "POST_BULK_DISMISS", { enumerable: true, get: function () { return route_6.POST_DISMISS; } });
Object.defineProperty(exports, "POST_BULK_SNOOZE", { enumerable: true, get: function () { return route_6.POST_SNOOZE; } });
// Notification test routes
var route_7 = require("./test/route");
Object.defineProperty(exports, "POST_TEST_NOTIFICATION", { enumerable: true, get: function () { return route_7.POST; } });
var send_test_notification_1 = require("./test/send-test-notification");
Object.defineProperty(exports, "POST_SEND_TEST_NOTIFICATION", { enumerable: true, get: function () { return send_test_notification_1.POST; } });
// Export the router as default
var router_1 = require("./router");
Object.defineProperty(exports, "default", { enumerable: true, get: function () { return __importDefault(router_1).default; } });
