import { createServer } from 'node:net';

const PREVIEW_PORT_BASE = 4000;
const PREVIEW_PORT_MAX = 4999;

export function findFreePort(startPort: number = PREVIEW_PORT_BASE): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = startPort;

    function tryNext() {
      if (port > PREVIEW_PORT_MAX) {
        reject(new Error('No free preview port available'));
        return;
      }

      const server = createServer();
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          port++;
          tryNext();
        } else {
          reject(err);
        }
      });
      server.once('listening', () => {
        server.close(() => resolve(port));
      });
      server.listen(port);
    }

    tryNext();
  });
}
