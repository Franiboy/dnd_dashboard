import { Router } from 'express';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { authMiddleware, requireApproved, type AuthRequest } from '../auth.js';
import { ensureWhiteboardUploadDir, listElementsForUser } from '../whiteboard.js';

const router = Router();

const whiteboardRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: (req) => (req as AuthRequest).user?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
});

const uploadRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => (req as AuthRequest).user?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
});

router.use(authMiddleware, requireApproved, whiteboardRateLimit);

// Initial load of the board. All further changes flow through Socket.io.
router.get('/', (req: AuthRequest, res) => {
  res.json({ elements: listElementsForUser(req.user!) });
});

const UPLOAD_MIME_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

// Screenshots and image files pasted onto the board. The client sends the
// raw bytes as base64 JSON so no multipart dependency is required.
router.post(
  '/uploads',
  express.json({ limit: '14mb' }),
  uploadRateLimit,
  (req: AuthRequest, res) => {
    const data = typeof req.body?.data === 'string' ? req.body.data : '';
    const type = typeof req.body?.type === 'string' ? req.body.type : '';

    const extension = UPLOAD_MIME_EXTENSIONS[type];
    if (!extension) {
      res.status(400).json({ error: 'Nur PNG, JPEG, GIF oder WebP werden unterstützt.' });
      return;
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(data, 'base64');
    } catch {
      res.status(400).json({ error: 'Ungültige Bilddaten.' });
      return;
    }
    if (buffer.length === 0 || buffer.length > MAX_UPLOAD_BYTES) {
      res.status(413).json({ error: 'Bild ist leer oder größer als 8 MB.' });
      return;
    }

    const dir = path.resolve(ensureWhiteboardUploadDir());
    const filename = `${randomUUID()}${extension}`;
    const target = path.join(dir, filename);
    // Defense in depth: never write outside the upload directory.
    if (!target.startsWith(dir)) {
      res.status(400).json({ error: 'Ungültiger Dateiname.' });
      return;
    }

    writeFile(target, buffer)
      .then(() => {
        res.json({ url: `/uploads/whiteboard/${filename}` });
      })
      .catch(() => {
        res.status(500).json({ error: 'Speichern fehlgeschlagen.' });
      });
  }
);

export default router;
