// Starts a Vite preview server for the built app and returns its URL.
import { preview } from 'vite';

export async function startServer(port = 4174) {
  const server = await preview({ preview: { port, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
  return { url: `http://127.0.0.1:${port}/`, close: () => server.httpServer.close() };
}
