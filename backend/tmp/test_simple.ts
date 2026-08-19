
import { Window } from 'happy-dom';
import { generateJSON } from '@tiptap/html';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';

const window = new Window();
// @ts-ignore
global.window = window;
// @ts-ignore
global.document = window.document;
// @ts-ignore
global.DOMParser = window.DOMParser;
// @ts-ignore
global.Node = window.Node;
// @ts-ignore
global.Element = window.Element;
// @ts-ignore
global.HTMLElement = window.HTMLElement;
// @ts-ignore
global.HTMLCollection = window.HTMLCollection;
// @ts-ignore
global.NodeList = window.NodeList;
// @ts-ignore
global.CharacterData = window.CharacterData;
// @ts-ignore
global.Text = window.Text;
// @ts-ignore
global.NamedNodeMap = window.NamedNodeMap;
// @ts-ignore
global.Attr = window.Attr;

async function main() {
  const html = '<p>Hello World</p>';
  const extensions = [
    Document,
    Paragraph,
    Text,
  ];

  try {
    console.log('Testing generateJSON with simple HTML...');
    const json = generateJSON(html, extensions);
    console.log('JSON:', JSON.stringify(json));
  } catch (err) {
    console.error('FAILED:', err);
  }
}

main().catch(console.error);
