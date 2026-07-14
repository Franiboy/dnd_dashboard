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
import authRouter from './routes/auth.js';
import { setupSocket } from './socket.js';
import { getVersion } from './version.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
const http = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(http, {
  cors: { origin: '*' },
});

const PORT = process.env.PORT || 3001;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Ensure admin user exists at startup
ensureAdminUser();

app.get('/api/version', (req, res) => {
  res.json(getVersion());
});

app.use('/api', authRouter);
app.use('/api/admin', adminRouter);

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

function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n${signal} received, shutting down gracefully...`);

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
