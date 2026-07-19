import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/types.js';
import { ensureAdminUser } from './users.js';
import adminRouter from './routes/admin.js';
import aiRouter from './routes/ai.js';
import authRouter from './routes/auth.js';
import diaryRouter from './routes/diary.js';
import recordingsRouter from './routes/recordings.js';
import { setupSocket } from './socket.js';
import { previewAuthMiddleware } from './auth.js';
import { getVersion } from './version.js';
import { runMigrations } from './migrations.js';
import { recoverPreviewServers, startFeatureRequestBehindWatcher } from './ai/worker.js';
import { startBot } from './discord/bot.js';
import { startTranscriptionScheduler, stopTranscriptionScheduler } from './discord/scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
const http = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(http, {
  cors: { origin: true, credentials: true },
});

const PORT = process.env.PORT || 3001;
const PREVIEW_MODE = process.env.PREVIEW_MODE === 'true';

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Disable caching for all API responses to avoid stale/304 responses
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Run schema migrations and ensure admin user exists at startup
runMigrations();
ensureAdminUser();
startBot();
startTranscriptionScheduler();

// In preview mode, all routes (API + static SPA) require an authenticated user
// with admin or preview access. Login endpoints are not exposed on previews.
if (PREVIEW_MODE) {
  app.use(previewAuthMiddleware);
}

app.get('/api/version', (req, res) => {
  res.json(getVersion());
});

app.use('/api', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/ai', aiRouter);
app.use('/api/diary', diaryRouter);
app.use('/api/recordings', recordingsRouter);

// Serve static files in production and fall back to index.html for all non-API routes
const distDir = path.join(__dirname, '..', '..', 'dist');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(distDir));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
      return next();
    }
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

setupSocket(io, PREVIEW_MODE);

const stopBehindWatcher = startFeatureRequestBehindWatcher();

http.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);

  // Restart preview servers for feature requests that were preview_ready before a server restart.
  // This runs after the server is listening so the main API is already reachable.
  recoverPreviewServers().catch((err) => {
    console.error('Failed to recover preview servers:', err);
  });
});

let isShuttingDown = false;

function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n${signal} received, shutting down gracefully...`);
  stopBehindWatcher();
  stopTranscriptionScheduler();

  // Force close after 1.5s even if sockets are still open
  const forceExit = setTimeout(() => {
    console.log('Forcing shutdown...');
    process.exit(0);
  }, 1500);

  // Close Socket.io to drop active connections
  io.close(() => {
    http.close(() => {
      clearTimeout(forceExit);
      process.exit(0);
    });
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGHUP', () => shutdown('SIGHUP'));
