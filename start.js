import { createServer } from 'vite';

(async () => {
  const server = await createServer({
    root: process.cwd(),
    server: {
      port: 0,
      host: '127.0.0.1'
    }
  });
  await server.listen();
  server.printUrls();
})();
