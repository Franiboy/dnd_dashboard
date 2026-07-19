import { Router } from 'express';
import { authMiddleware, requireApproved, type AuthRequest } from '../auth.js';
import { isAiEnabled } from '../ai/config.js';
import { rewriteTextWithAi } from '../ai/rewrite.js';
import {
  createDiaryEntry,
  getDiaryEntryById,
  listDiaryEntriesByUser,
  updateDiaryEntry,
  deleteDiaryEntry,
} from '../repositories/diary.js';

const router = Router();

router.use(authMiddleware, requireApproved);

router.get('/entries', (req: AuthRequest, res) => {
  if (!req.user) {
    res.status(403).json({ error: 'Nicht autorisiert' });
    return;
  }
  const entries = listDiaryEntriesByUser(req.user.id);
  res.json({ entries });
});

router.post('/entries', (req: AuthRequest, res) => {
  if (!req.user) {
    res.status(403).json({ error: 'Nicht autorisiert' });
    return;
  }

  const { title, content } = req.body;
  if (!title || typeof title !== 'string' || !title.trim()) {
    res.status(400).json({ error: 'Titel ist erforderlich' });
    return;
  }
  if (!content || typeof content !== 'string' || !content.trim()) {
    res.status(400).json({ error: 'Inhalt ist erforderlich' });
    return;
  }

  const entry = createDiaryEntry(req.user.id, title, content);
  res.status(201).json({ entry });
});

router.get('/entries/:id', (req: AuthRequest, res) => {
  if (!req.user) {
    res.status(403).json({ error: 'Nicht autorisiert' });
    return;
  }

  const id = Number(req.params.id);
  const entry = getDiaryEntryById(id);
  if (!entry || entry.userId !== req.user.id) {
    res.status(404).json({ error: 'Eintrag nicht gefunden' });
    return;
  }
  res.json({ entry });
});

router.put('/entries/:id', (req: AuthRequest, res) => {
  if (!req.user) {
    res.status(403).json({ error: 'Nicht autorisiert' });
    return;
  }

  const id = Number(req.params.id);
  const existing = getDiaryEntryById(id);
  if (!existing || existing.userId !== req.user.id) {
    res.status(404).json({ error: 'Eintrag nicht gefunden' });
    return;
  }

  const { title, content, rewrittenContent } = req.body;
  const updates: Parameters<typeof updateDiaryEntry>[1] = {};

  if (title !== undefined) {
    if (typeof title !== 'string' || !title.trim()) {
      res.status(400).json({ error: 'Titel darf nicht leer sein' });
      return;
    }
    updates.title = title;
  }
  if (content !== undefined) {
    if (typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ error: 'Inhalt darf nicht leer sein' });
      return;
    }
    updates.content = content;
  }
  if (rewrittenContent !== undefined) {
    updates.rewrittenContent = typeof rewrittenContent === 'string' ? rewrittenContent : null;
  }

  const entry = updateDiaryEntry(id, updates);
  if (!entry) {
    res.status(500).json({ error: 'Aktualisieren fehlgeschlagen' });
    return;
  }
  res.json({ entry });
});

router.delete('/entries/:id', (req: AuthRequest, res) => {
  if (!req.user) {
    res.status(403).json({ error: 'Nicht autorisiert' });
    return;
  }

  const id = Number(req.params.id);
  const existing = getDiaryEntryById(id);
  if (!existing || existing.userId !== req.user.id) {
    res.status(404).json({ error: 'Eintrag nicht gefunden' });
    return;
  }

  deleteDiaryEntry(id);
  res.json({ ok: true });
});

router.post('/entries/:id/rewrite', async (req: AuthRequest, res) => {
  if (!req.user) {
    res.status(403).json({ error: 'Nicht autorisiert' });
    return;
  }

  if (!isAiEnabled()) {
    res.status(503).json({ error: 'KI-Feature ist nicht konfiguriert' });
    return;
  }

  const id = Number(req.params.id);
  const existing = getDiaryEntryById(id);
  if (!existing || existing.userId !== req.user.id) {
    res.status(404).json({ error: 'Eintrag nicht gefunden' });
    return;
  }

  const rewritten = await rewriteTextWithAi(existing.content);
  if (rewritten === null) {
    res.status(500).json({ error: 'KI-Umschreiben ist fehlgeschlagen' });
    return;
  }

  const entry = updateDiaryEntry(id, { rewrittenContent: rewritten });
  if (!entry) {
    res.status(500).json({ error: 'Speichern fehlgeschlagen' });
    return;
  }
  res.json({ entry });
});

export default router;
