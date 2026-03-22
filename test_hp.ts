import { HocuspocusCollaborationServer } from './src/hybrid/websockets/hocuspocus-server';

console.log('Attempting to initialize HocuspocusCollaborationServer...');
try {
  const server = new HocuspocusCollaborationServer();
  console.log('Server initialized successfully!');
} catch (error) {
  console.error('Failed to initialize server:', error);
}
