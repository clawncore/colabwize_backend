import { Extension } from "@tiptap/core";

export const AITrackingExtension = Extension.create({
    name: "aiTracking",

    addStorage() {
        return {
            aiEditCount: 0,
        };
    },
});

export default AITrackingExtension;
