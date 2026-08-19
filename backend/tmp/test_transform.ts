
import { Window } from 'happy-dom';
import { PrismaClient } from '@prisma/client';
import { generateJSON } from '@tiptap/html';
import StarterKit from '@tiptap/starter-kit';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import ImageExtension from '../src/extensions/ImageExtension';

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

const prisma = new PrismaClient();

async function main() {
  const projectId = '6be99909-8907-44fc-9b3b-e3adab9c38ab';
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { content: true }
  });

  if (!project || typeof project.content !== 'string') {
    console.log('Project not found or content is not string');
    return;
  }

  const html = project.content;
  console.log('HTML Length:', html.length);

  const extensions = [
    Document,
    Paragraph,
    Text,
    ImageExtension,
  ];

  try {
    console.log('Starting transformation...');
    const json = generateJSON(html, extensions);
    console.log('JSON generated successfully.');
    console.log('--- JSON Structure ---');
    console.log(JSON.stringify(json, null, 2).substring(0, 2000));
    console.log('--- End JSON ---');
    
    const nodeTypes = new Set<string>();
    const walkNodes = (nodes: any[]) => {
      nodes.forEach(n => {
        nodeTypes.add(n.type);
        if (n.content) walkNodes(n.content);
      });
    };
    if (json.content) walkNodes(json.content);
    console.log('Unique node types:', Array.from(nodeTypes));
    
    const imageNodes = (json.content || []).flatMap((n: any) => {
        const found: any[] = [];
        const findImg = (node: any) => {
            if (node.type === 'imageExtension' || node.type === 'image') found.push(node);
            if (node.content) node.content.forEach(findImg);
        };
        findImg(n);
        return found;
    });
    console.log('Found image nodes (recursive):', imageNodes.length);
    
  } catch (err) {
    console.error('Transformation FAILED:', err);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
