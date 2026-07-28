import { Router, type Response } from 'express';
import { authMiddleware, requireApproved, type AuthRequest } from '../auth.js';
import { isAiEnabled } from '../ai/config.js';
import { extractEntitiesFromDiary, improveRewrittenWithCommand, rewriteTextWithAi, summarizeTextWithAi, stripAnsi } from '../ai/rewrite.js';
import { distributeKnowledgeFromText, getKnowledgeContextForText } from '../ai/knowledge.js';
import { deleteOpenCodeSession } from '../ai/opencode.js';
import { deleteRewrittenFile, getRewrittenFilePath, readRewrittenFile } from '../diaryFiles.js';
import { createLogger } from '../logger.js';
import {
  createDiaryEntry,
  getDiaryEntryById,
  listDiaryEntriesByUser,
  updateDiaryEntry,
  deleteDiaryEntry,
} from '../repositories/diary.js';

const log = createLogger('diaryRoutes');

const SUMMARY_MAX_LENGTH = 500;

function truncateSummary(text: string, maxLength: number = SUMMARY_MAX_LENGTH): string {
  if (text.length <= maxLength) return text;
  const prefix = text.slice(0, maxLength - 3);
  const cut = Math.max(prefix.lastIndexOf(' '), prefix.lastIndexOf('\n'));
  if (cut <= 0 || cut < maxLength * 0.5) {
    return prefix + '...';
  }
  return text.slice(0, cut) + '...';
}

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
  log.info(`Listing diary entries for user ${req.user.id}`);
  const entries = listDiaryEntriesByUser(req.user.id);
  res.json({ entries });
});

router.get('/entries/:id', (req: AuthRequest, res) => {
  if (!req.user) {
    res.status(403).json({ error: 'Nicht autorisiert' });
    return;
  }
  const id = Number(req.params.id);
  log.info(`Fetching diary entry ${id}`);
  const entry = getDiaryEntryById(id);
  if (!entry || entry.userId !== req.user.id) {
    res.status(404).json({ error: 'Eintrag nicht gefunden' });
    return;
  }
  res.json({ entry });
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
  log.info(`Update requested for entry ${id}: body keys=${Object.keys(req.body).join(', ')}`);
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
    if (existing.rewrittenContent) {
      const fileContent = readRewrittenFile(id);
      updates.content = fileContent ?? content;
      updates.rewrittenContent = null;
      updates.rewrittenFilePath = null;
      updates.rewriteSessionId = null;
    } else {
      updates.content = content;
    }
  }
  if (summary !== undefined) {
    if (!isSummaryValid(summary)) {
      res.status(400).json({ error: `Zusammenfassung darf maximal ${SUMMARY_MAX_LENGTH} Zeichen haben` });
      return;
    }
    updates.summary = summary;
  }
  if (rewrittenContent !== undefined) {
    const clearing = typeof rewrittenContent === 'string' ? !rewrittenContent : true;
    if (clearing && existing.rewrittenContent) {
      updates.rewrittenContent = null;
      updates.rewrittenFilePath = null;
      updates.rewriteSessionId = null;
    } else {
      updates.rewrittenContent = typeof rewrittenContent === 'string' ? rewrittenContent : null;
    }
  }

  if (updates.rewrittenFilePath === null && existing.rewrittenFilePath) {
    deleteRewrittenFile(id);
    log.info(`Cleared rewritten file for entry ${id}`);
  }
  if (updates.rewriteSessionId === null && existing.rewriteSessionId) {
    deleteOpenCodeSession(existing.rewriteSessionId);
    log.info(`Deleted rewrite opencode session for entry ${id}`);
  }

  const entry = updateDiaryEntry(id, updates);
  if (!entry) {
    log.error(`Failed to update entry ${id}`);
    res.status(500).json({ error: 'Aktualisieren fehlgeschlagen' });
    return;
  }
  log.info(`Entry ${id} updated`);
  res.json({ entry });
});

router.delete('/entries/:id', (req: AuthRequest, res) => {
  if (!req.user) {
    res.status(403).json({ error: 'Nicht autorisiert' });
    return;
  }

  const id = Number(req.params.id);
  log.info(`Delete requested for entry ${id}`);
  const existing = getDiaryEntryById(id);
  if (!existing || existing.userId !== req.user.id) {
    res.status(404).json({ error: 'Eintrag nicht gefunden' });
    return;
  }

  if (existing.rewrittenFilePath) {
    deleteRewrittenFile(id);
    log.info(`Deleted rewritten file for entry ${id}`);
  }
  if (existing.rewriteSessionId) {
    deleteOpenCodeSession(existing.rewriteSessionId);
    log.info(`Deleted rewrite opencode session for entry ${id}`);
  }
  deleteDiaryEntry(id);
  log.info(`Entry ${id} deleted`);
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
  log.info(`Rewrite requested for entry ${id}`);
  const existing = getDiaryEntryById(id);
  if (!existing || existing.userId !== req.user.id) {
    res.status(404).json({ error: 'Eintrag nicht gefunden' });
    return;
  }

  const stopProgress = startProgressMessages(req.user!.id, 'KI schreibt den Text um...');
  try {
    const onLog = (line: string) => notifyDiaryAiLog(req.user!.id, line);
    const knowledgeContext = getKnowledgeContextForText(existing.content, { entryId: existing.id });
    log.info(`Calling rewriteTextWithAi for entry ${id}, sessionId=${existing.rewriteSessionId ?? 'none'}`);
    const { content: rewritten, sessionId } = await rewriteTextWithAi(
      id,
      existing.content,
      existing.rewrittenContent,
      existing.rewriteSessionId ?? null,
      undefined,
      onLog,
      knowledgeContext,
    );
    if (rewritten === null) {
      log.error(`rewriteTextWithAi returned null for entry ${id}`);
      res.status(500).json({ error: 'KI-Umschreiben ist fehlgeschlagen' });
      return;
    }

    log.info(`Saving rewritten file path and session for entry ${id}`);
    sendDiaryAiStatus(req.user!.id, 'Ergebnis wird gespeichert...');
    const entry = updateDiaryEntry(id, {
      rewrittenContent: null,
      rewrittenFilePath: getRewrittenFilePath(id),
      rewriteSessionId: sessionId,
    });
    if (!entry) {
      log.error(`Failed to update diary entry ${id}`);
      res.status(500).json({ error: 'Speichern fehlgeschlagen' });
      return;
    }
    log.info(`Rewrite completed for entry ${id}`);
    res.json({ entry });
  } catch (err) {
    log.error(`Unexpected error during rewrite of entry ${id}:`, err);
    res.status(500).json({ error: 'KI-Umschreiben ist fehlgeschlagen' });
  } finally {
    stopProgress();
  }
});

router.post('/entries/:id/rewrite-command', async (req: AuthRequest, res) => {
  if (!req.user) {
    res.status(403).json({ error: 'Nicht autorisiert' });
    return;
  }

  if (!isAiEnabled()) {
    res.status(503).json({ error: 'KI-Feature ist nicht konfiguriert' });
    return;
  }

  const id = Number(req.params.id);
  const { command } = req.body;
  if (typeof command !== 'string' || !command.trim()) {
    res.status(400).json({ error: 'Befehl ist erforderlich' });
    return;
  }

  log.info(`Rewrite command requested for entry ${id}: ${command.trim()}`);
  const existing = getDiaryEntryById(id);
  if (!existing || existing.userId !== req.user.id) {
    res.status(404).json({ error: 'Eintrag nicht gefunden' });
    return;
  }
  if (!existing.rewriteSessionId) {
    res.status(400).json({ error: 'Keine aktive KI-Session vorhanden' });
    return;
  }
  if (!existing.rewrittenFilePath) {
    res.status(400).json({ error: 'Keine KI-Version vorhanden' });
    return;
  }

  const stopProgress = startProgressMessages(req.user!.id, 'KI bearbeitet den Text...');
  try {
    const onLog = (line: string) => notifyDiaryAiLog(req.user!.id, line);
    const knowledgeContext = getKnowledgeContextForText(existing.content, { entryId: existing.id });
    const { content: rewritten, sessionId } = await improveRewrittenWithCommand(
      id,
      existing.content,
      existing.rewrittenContent || readRewrittenFile(id) || '',
      command.trim(),
      existing.rewriteSessionId,
      undefined,
      onLog,
      knowledgeContext,
    );
    if (rewritten === null) {
      log.error(`improveRewrittenWithCommand returned null for entry ${id}`);
      res.status(500).json({ error: 'KI-Befehl ist fehlgeschlagen' });
      return;
    }

    sendDiaryAiStatus(req.user!.id, 'Ergebnis wird gespeichert...');
    const entry = updateDiaryEntry(id, {
      rewrittenContent: null,
      rewrittenFilePath: getRewrittenFilePath(id),
      rewriteSessionId: sessionId,
    });
    if (!entry) {
      log.error(`Failed to update diary entry ${id} after command`);
      res.status(500).json({ error: 'Speichern fehlgeschlagen' });
      return;
    }
    log.info(`Rewrite command completed for entry ${id}`);
    res.json({ entry });
  } catch (err) {
    log.error(`Unexpected error during rewrite command of entry ${id}:`, err);
    res.status(500).json({ error: 'KI-Befehl ist fehlgeschlagen' });
  } finally {
    stopProgress();
  }
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
    const knowledgeContext = getKnowledgeContextForText(existing.content, { entryId: existing.id });
    const [summary] = await Promise.all([
      summarizeTextWithAi(existing.id, existing.content, undefined, onLog, knowledgeContext),
      extractEntitiesFromDiary(existing.id, existing.content, undefined, onLog, knowledgeContext),
    ]);
    if (summary === null) {
      res.status(500).json({ error: 'KI-Zusammenfassung ist fehlgeschlagen' });
      return;
    }

    sendDiaryAiStatus(req.user!.id, 'Ergebnisse werden gespeichert...');
    const entry = updateDiaryEntry(id, { summary: truncateSummary(summary) });
    if (!entry) {
      res.status(500).json({ error: 'Speichern fehlgeschlagen' });
      return;
    }

    sendDiaryAiStatus(req.user!.id, 'Wissen wird aus dem Eintrag abgeleitet...');
    try {
      await distributeKnowledgeFromText(existing.content, undefined, onLog);
    } catch {
      // Knowledge distribution is optional.
    }

    res.json({ entry });
  } finally {
    stopProgress();
  }
});

export default router;
