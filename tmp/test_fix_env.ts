
import { generateJSON } from "@tiptap/html";
import StarterKit from "@tiptap/starter-kit";
import { Window } from "happy-dom";

// Simulate the initialization in hocuspocus-server.ts
const dom = new Window();
(global as any).window = dom;
(global as any).document = dom.document;
(global as any).Node = dom.Node;
(global as any).Element = dom.Element;
(global as any).HTMLElement = dom.HTMLElement;

async function test() {
    const html = '<p>Hello <strong>world</strong></p>';
    const extensions = [StarterKit];
    
    try {
        const json = generateJSON(html, extensions);
        console.log('Transformation SUCCESS!');
        console.log('JSON Output:', JSON.stringify(json, null, 2));
    } catch (error) {
        console.error('Transformation FAILED:', error);
    }
}

test();
