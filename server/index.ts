import 'dotenv/config';
import { logger } from './logger.js';
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
import authRouter from './routes/auth.js';
import aiRouter from './routes/ai.js';
import bingoRouter from './routes/bingo.js';
import diaryRouter from './routes/diary.js';
import entitiesRouter from './routes/entities.js';
import recordingsRouter from './routes/recordings.js';
import { setupSocket } from './socket.js';
import { getVersion } from './version.js';
import { runMigrations } from './migrations.js';
import { startBot, recoverAllRecordings, stopBot } from './discord/bot.js';
import { startTranscriptionScheduler, stopTranscriptionScheduler } from './discord/scheduler.js';
import { resetInterruptedTranscriptions, stopAllTranscriptions } from './discord/transcriber.js';
import {
  startEntitySummaryScheduler,
  stopEntitySummaryScheduler,
} from './scheduler/entitySummaries.js';
import {
  startDiarySummaryScheduler,
  stopDiarySummaryScheduler,
} from './scheduler/diarySummaries.js';
import {
  startSessionCleanupScheduler,
  stopSessionCleanupScheduler,
} from './scheduler/sessionCleanup.js';
import {
  startBingoSuggestionScheduler,
  stopBingoSuggestionScheduler,
} from './scheduler/bingoSuggestions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getCorsOrigin(): string[] | boolean {
  if (process.env.CORS_ORIGIN) {
    return process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  // Development: allow only the common local origins. Never reflect arbitrary origins.
  return ['http://localhost:5173', 'http://localhost:3001'];
}

const corsOrigin = getCorsOrigin();

const app = express();
app.set('trust proxy', 1);
const http = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(http, {
  cors: { origin: corsOrigin, credentials: true },
});
app.set('io', io);

const PORT = process.env.PORT || 3001;

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Generic request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
  });
  next();
});

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
try {
  await recoverAllRecordings();
  resetInterruptedTranscriptions();
} catch (err) {
  logger.error('Failed to recover recordings on startup:', err);
}
startBot();
startTranscriptionScheduler();
startDiarySummaryScheduler();
startEntitySummaryScheduler();
startSessionCleanupScheduler();
startBingoSuggestionScheduler();

app.get('/api/version', (req, res) => {
  res.json(getVersion());
});

app.use('/api', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/ai', aiRouter);
app.use('/api/bingo', bingoRouter);
app.use('/api/diary', diaryRouter);
app.use('/api/entities', entitiesRouter);
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

setupSocket(io);

http.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

let isShuttingDown = false;

async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n${signal} received, shutting down gracefully...`);

  // Close the server immediately so no new connections come in while we
  // finish active work. Keep the process alive until cleanup is done.
  const serverClosed = new Promise<void>((resolve) => {
    io.close(() => {
      resolve();
    });
  });

  // Safety net covering the entire shutdown sequence (cleanup, recovery, server close).
  const forceExit = setTimeout(() => {
    console.log('Forcing shutdown...');
    process.exit(0);
  }, 30000);

  await stopAllTranscriptions().catch((err) => {
    logger.error('Failed to stop transcriptions:', err);
  });

  await recoverAllRecordings().catch((err) => {
    logger.error('Failed to recover recordings:', err);
  });

  await stopBot().catch((err) => {
    logger.error('Failed to stop Discord bot:', err);
  });

  stopTranscriptionScheduler();
  stopDiarySummaryScheduler();
  stopEntitySummaryScheduler();
  stopSessionCleanupScheduler();
  stopBingoSuggestionScheduler();

  await serverClosed;
  clearTimeout(forceExit);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGHUP', () => shutdown('SIGHUP'));
