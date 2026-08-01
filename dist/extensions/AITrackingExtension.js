"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AITrackingExtension = void 0;
const core_1 = require("@tiptap/core");
exports.AITrackingExtension = core_1.Extension.create({
    name: "aiTracking",
    addStorage() {
        return {
            aiEditCount: 0,
        };
    },
});
exports.default = exports.AITrackingExtension;
