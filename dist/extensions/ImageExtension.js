"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImageExtension = void 0;
const extension_image_1 = require("@tiptap/extension-image");
exports.ImageExtension = extension_image_1.Image.extend({
    name: "imageExtension",
    addAttributes() {
        return {
            ...this.parent?.(),
            width: {
                default: null,
            },
            height: {
                default: null,
            },
            rotate: {
                default: 0,
            },
            align: {
                default: "center",
            },
        };
    },
});
exports.default = exports.ImageExtension;
