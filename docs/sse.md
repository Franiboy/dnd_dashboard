# Server-Sent Events (SSE)

Besides Socket.io for Bingo, state updates are delivered via **Server-Sent Events**. The pattern is the same everywhere:

1. The client opens an `EventSource` stream to a `GET /api/.../events` endpoint.
2. The server keeps open `Response` objects in an `SseBroadcaster` (`server/utils/sse.ts`).
3. Mutating endpoints change state and call a `notify...()` function that pushes the current state to all open streams.
4. The client receives the state via `addEventListener('<event>', ...)`. Connection drops are automatically reconnected by the browser.

## Existing SSE Endpoints

| Endpoint                      | Event                              | Payload                            | Description          |
| ----------------------------- | ---------------------------------- | ---------------------------------- | -------------------- |
| `GET /api/admin/users/events` | `users`                            | `SafeUser[]`                       | User list (admin)    |
| `GET /api/admin/logs/events`  | `logs` / `log`                     | `LogEntry[]` / `LogEntry`          | Live logs (admin)    |
| `GET /api/recordings/events`  | `status` / `sessions` / `progress` | Recording status and lists (admin) |
| `GET /api/diary/ai-events`    | `log` / `connected`                | `{ message: string }`              | AI progress in diary |

## Conventions for New SSE Streams

- Endpoint: `GET /api/<area>/events`, protected with `authMiddleware` and optionally `requireAdmin`.
- Set headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`.
- Write the initial state immediately.
- Use `SseBroadcaster.add(res)`; register the returned cleanup function on `req.on('close')`, `res.on('close')` and `res.on('error')`.
- Use `SseBroadcaster.broadcast(event, JSON.stringify(payload))` for distribution; disconnected clients are automatically removed.
- The client uses `new EventSource('/api/<area>/events', { withCredentials: true })` so the `httpOnly` JWT cookie is sent.
- Commands / changes from the client still go through separate `fetch`/`POST` calls, not the SSE stream.
