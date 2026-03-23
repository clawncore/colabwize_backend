import { Image as TiptapImage } from "@tiptap/extension-image";

export const ImageExtension = TiptapImage.extend({
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

export default ImageExtension;
