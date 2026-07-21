import { Router, type Response } from 'express';
import { authMiddleware, requireApproved, type AuthRequest } from '../auth.js';
import { isAiEnabled } from '../ai/config.js';
import { extractEntitiesFromDiary, rewriteTextWithAi, summarizeTextWithAi, stripAnsi } from '../ai/rewrite.js';
import {
  createDiaryEntry,
  getDiaryEntryById,
  listDiaryEntriesByUser,
  updateDiaryEntry,
  deleteDiaryEntry,
  findExistingEntitiesInText,
  mergeEntities,
  finalizeEntities,
} from '../repositories/diary.js';

const SUMMARY_MAX_LENGTH = 500;

const sseClients = new Map<string, Set<Response>>();

function sendDiaryAiStatus(userId: string, message: string) {
  const clients = sseClients.get(userId);
  if (!clients || clients.size === 0) return;

  const payload = JSON.stringify({ message });
  for (const client of clients) {
    try {
      client.write(`event: log\ndata: ${payload}\n\n`);
    } catch {
      clients.delete(client);
    }
  }
}

function startProgressMessages(userId: string, initialMessage: string): () => void {
  const messages = [
    'KI-Modell wird geladen...',
    'KI-Anfrage wird vorbereitet...',
    'KI generiert Zusammenfassung und Personen...',
    'KI arbeitet noch...',
    'Fast fertig...',
  ];
  let index = 0;
  sendDiaryAiStatus(userId, initialMessage);
  const interval = setInterval(() => {
    sendDiaryAiStatus(userId, messages[index % messages.length]);
    index++;
  }, 3000);
  return () => clearInterval(interval);
}

function mapOpencodeStatus(line: string): string | null {
  const [action] = line.split('·').map((s) => s.trim());
  switch (action.toLowerCase()) {
    case 'build':
      return 'KI-Modell wird geladen...';
    case 'run':
      return 'KI-Anfrage wird ausgeführt...';
    default:
      return `KI arbeitet: ${action}`;
  }
}

function notifyDiaryAiLog(userId: string, raw: string) {
  const clients = sseClients.get(userId);
  if (!clients || clients.size === 0) return;

  const messages = stripAnsi(raw)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line)
    .flatMap((line) => {
      const statusMatch = line.match(/^>\s*(.+)$/);
      if (statusMatch) {
        const mapped = mapOpencodeStatus(statusMatch[1]);
        return mapped ? [mapped] : [];
      }
      // Forward short diagnostic/error lines from OpenCode.
      if (/^(error|fehler|warn|warning|opencode|spawn)/i.test(line)) {
        return [line];
      }
      // Ignore raw AI output (summary text, JSON, code blocks);
      // the final result is delivered via the normal HTTP response.
      return [];
    });

  const dataPrefix = `event: log\ndata: `;
  for (const message of messages) {
    const payload = JSON.stringify({ message });
    for (const client of clients) {
      try {
        client.write(`${dataPrefix}${payload}\n\n`);
      } catch {
        clients.delete(client);
      }
    }
  }
}

const router = Router();

router.use(authMiddleware, requireApproved);

router.get('/ai-events', (req: AuthRequest, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const userId = req.user!.id;
  if (!sseClients.has(userId)) {
    sseClients.set(userId, new Set());
  }
  sseClients.get(userId)!.add(res);

  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({ ok: true })}\n\n`);

  req.on('close', () => {
    sseClients.get(userId)?.delete(res);
  });
});

function isSummaryValid(summary: unknown): summary is string | null {
  if (summary === null || summary === undefined) return true;
  if (typeof summary !== 'string') return false;
  return summary.length <= SUMMARY_MAX_LENGTH;
}

router.get('/entries', (req: AuthRequest, res) => {
  if (!req.user) {
    res.status(403).json({ error: 'Nicht autorisiert' });
    return;
  }
  const entries = listDiaryEntriesByUser(req.user.id);
  res.json({ entries });
});

router.post('/entries', async (req: AuthRequest, res) => {
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

  let entry = createDiaryEntry(req.user.id, title, content);
  if (isAiEnabled()) {
    const stopProgress = startProgressMessages(req.user!.id, 'KI analysiert den Tagebucheintrag...');
    try {
      const onLog = (line: string) => notifyDiaryAiLog(req.user!.id, line);
      const [summary, aiEntities] = await Promise.all([
        summarizeTextWithAi(content, undefined, onLog).catch(() => null),
        extractEntitiesFromDiary(content, undefined, onLog).catch(() => ({
          persons: [],
          organizations: [],
          locations: [],
        })),
      ]);
      const existingEntities = findExistingEntitiesInText(content);
      const entities = finalizeEntities(mergeEntities(aiEntities, existingEntities));

      sendDiaryAiStatus(req.user!.id, 'Ergebnisse werden gespeichert...');
      const updates: Parameters<typeof updateDiaryEntry>[1] = {};
      if (summary !== null) {
        updates.summary = summary.slice(0, SUMMARY_MAX_LENGTH);
      }
      if (entities.persons.length > 0) {
        updates.persons = entities.persons;
      }
      if (entities.organizations.length > 0) {
        updates.organizations = entities.organizations;
      }
      if (entities.locations.length > 0) {
        updates.locations = entities.locations;
      }
      if (Object.keys(updates).length > 0) {
        const updated = updateDiaryEntry(entry.id, updates);
        if (updated) entry = updated;
      }
    } catch {
      // AI generation failed; the entry has already been created.
    } finally {
      stopProgress();
    }
  }

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

  const { title, content, summary, rewrittenContent } = req.body;
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
  if (summary !== undefined) {
    if (!isSummaryValid(summary)) {
      res.status(400).json({ error: `Zusammenfassung darf maximal ${SUMMARY_MAX_LENGTH} Zeichen haben` });
      return;
    }
    updates.summary = summary;
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

router.post('/entries/:id/summarize', async (req: AuthRequest, res) => {
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

  const stopProgress = startProgressMessages(req.user!.id, 'KI analysiert den Tagebucheintrag...');
  try {
    const onLog = (line: string) => notifyDiaryAiLog(req.user!.id, line);
    const [summary, aiEntities] = await Promise.all([
      summarizeTextWithAi(existing.content, undefined, onLog),
      extractEntitiesFromDiary(existing.content, undefined, onLog),
    ]);
    if (summary === null) {
      res.status(500).json({ error: 'KI-Zusammenfassung ist fehlgeschlagen' });
      return;
    }

    const existingEntities = findExistingEntitiesInText(existing.content);
    const entities = finalizeEntities(mergeEntities(aiEntities, existingEntities));

    sendDiaryAiStatus(req.user!.id, 'Ergebnisse werden gespeichert...');
    const updates: Parameters<typeof updateDiaryEntry>[1] = { summary: summary.slice(0, SUMMARY_MAX_LENGTH) };
    if (entities.persons.length > 0) {
      updates.persons = entities.persons;
    }
    if (entities.organizations.length > 0) {
      updates.organizations = entities.organizations;
    }
    if (entities.locations.length > 0) {
      updates.locations = entities.locations;
    }

    const entry = updateDiaryEntry(id, updates);
    if (!entry) {
      res.status(500).json({ error: 'Speichern fehlgeschlagen' });
      return;
    }
    res.json({ entry });
  } finally {
    stopProgress();
  }
});

export default router;
