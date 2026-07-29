import type { Response } from 'express';

export function writeSse(res: Response, event: string, data: string): boolean {
  if (res.destroyed || res.writableEnded) return false;
  const payload = `event: ${event}\ndata: ${data}\n\n`;
  try {
    const ok = res.write(payload);
    if (!ok) {
      // Backpressure: close gracefully rather than destroying the socket.
      res.end();
    }
    return ok;
  } catch {
    return false;
  }
}

export class SseBroadcaster {
  private clients = new Set<Response>();

  add(res: Response): () => void {
    this.clients.add(res);
    return () => {
      this.clients.delete(res);
    };
  }

  remove(res: Response): void {
    this.clients.delete(res);
  }

  broadcast(event: string, data: string): void {
    const payload = `event: ${event}\ndata: ${data}\n\n`;
    const toRemove: Response[] = [];
    for (const client of this.clients) {
      if (client.destroyed || client.writableEnded) {
        toRemove.push(client);
        continue;
      }
      let remove = false;
      try {
        const ok = client.write(payload);
        if (!ok) {
          remove = true;
          // Gracefully close slow clients that cannot keep up.
          client.end();
        }
      } catch {
        remove = true;
      }
      if (remove) {
        toRemove.push(client);
      }
    }
    for (const client of toRemove) {
      this.clients.delete(client);
    }
  }

  get size(): number {
    return this.clients.size;
  }
}
