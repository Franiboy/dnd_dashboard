import { Router } from 'express';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { AppError, parseWith } from '../errors.js';
import { authMiddleware, requireApproved, type AuthRequest } from '../auth.js';
import { ensureWhiteboardUploadDir } from '../whiteboard.js';
import { listElementsForUser } from '../repositories/whiteboard.js';

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

const uploadSchema = z.object({
  data: z.preprocess((v) => (typeof v === 'string' ? v : ''), z.string()),
  type: z.preprocess((v) => (typeof v === 'string' ? v : ''), z.string()),
});

// Screenshots and image files pasted onto the board. The client sends the
// raw bytes as base64 JSON so no multipart dependency is required.
router.post(
  '/uploads',
  express.json({ limit: '14mb' }),
  uploadRateLimit,
  async (req: AuthRequest, res) => {
    const { data, type } = parseWith(uploadSchema, req.body);

    const extension = UPLOAD_MIME_EXTENSIONS[type];
    if (!extension) {
      throw new AppError(400, 'Nur PNG, JPEG, GIF oder WebP werden unterstützt.');
    }

    // Buffer.from ignores invalid base64 characters instead of throwing,
    // so a zero-length buffer is the "unparseable" signal here.
    const buffer = Buffer.from(data, 'base64');
    if (buffer.length === 0 || buffer.length > MAX_UPLOAD_BYTES) {
      throw new AppError(413, 'Bild ist leer oder größer als 8 MB.');
    }

    const dir = path.resolve(ensureWhiteboardUploadDir());
    const filename = `${randomUUID()}${extension}`;
    const target = path.join(dir, filename);
    // Defense in depth: never write outside the upload directory.
    if (!target.startsWith(dir)) {
      throw new AppError(400, 'Ungültiger Dateiname.');
    }

    try {
      await writeFile(target, buffer);
    } catch (err) {
      throw new AppError(500, 'Speichern fehlgeschlagen.', { cause: err });
    }
    res.json({ url: `/uploads/whiteboard/${filename}` });
  }
);

export default router;
