import { Router } from 'express';
import { z } from 'zod';
import { AppError, parseWith } from '../errors.js';
import { aiRateLimit } from '../utils/rateLimits.js';
import { authMiddleware, requireApproved, requireUser, type AuthRequest } from '../auth.js';
import { isAiEnabled } from '../ai/config.js';
import {
  improveRewrittenWithCommand,
  processDiaryEntryAi,
  rewriteTextWithAi,
} from '../ai/rewrite.js';
import { deleteOpenCodeSession } from '../ai/opencode.js';
import { deleteRewrittenFile, getRewrittenFilePath, readRewrittenFile } from '../diaryFiles.js';
import { createLogger } from '../logger.js';
import { writeSse } from '../utils/sse.js';
import {
  createDiaryEntryOncePerDay,
  getDiaryEntryById,
  listDiaryEntriesByUser,
  updateDiaryEntry,
  deleteDiaryEntry,
} from '../repositories/diary.js';
import { recordSessionToDiaryTransfer } from '../repositories/recordings.js';
import { getStoryArc } from '../repositories/storyArcs.js';
import {
  getUserBroadcaster,
  notifyDiaryAiLog,
  releaseUserBroadcaster,
  sendDiaryAiStatus,
  startProgressMessages,
} from '../diaryAiEvents.js';

const log = createLogger('diaryRoutes');

const SUMMARY_MAX_LENGTH = 500;

const router = Router();

const idParamSchema = z.coerce.number().int().positive({ error: 'Ungültige ID' });

const trimmedContent = (message: string) => z.string({ error: message }).trim().min(1, message);

const createEntrySchema = z.object({
  content: trimmedContent('Inhalt ist erforderlich'),
  gameDay: z.preprocess(
    (v) => (v === undefined || v === null ? undefined : Number(v)),
    z
      .number({ error: 'Spieltag muss eine positive ganze Zahl sein' })
      .int('Spieltag muss eine positive ganze Zahl sein')
      .positive('Spieltag muss eine positive ganze Zahl sein')
  ),
  arcId: z.preprocess(
    (v) => (v === undefined || v === null ? undefined : Number(v)),
    z
      .number({ error: 'arcId muss eine positive ganze Zahl oder null sein' })
      .int('arcId muss eine positive ganze Zahl oder null sein')
      .positive('arcId muss eine positive ganze Zahl oder null sein')
      .optional()
  ),
});

/** arcId in update bodies additionally accepts null to clear the assignment. */
const editableArcIdSchema = z.union([z.null(), z.coerce.number().int().positive()], {
  error: 'arcId muss eine positive ganze Zahl oder null sein',
});

/** Guards entry ownership; diary entries are always private to their author. */
function requireOwnEntry(id: number, userId: string) {
  const entry = getDiaryEntryById(id);
  if (!entry || entry.userId !== userId) {
    throw new AppError(404, 'Eintrag nicht gefunden');
  }
  return entry;
}

function requireAiEnabled(): void {
  if (!isAiEnabled()) {
    throw new AppError(503, 'KI-Feature ist nicht konfiguriert');
  }
}

router.use(authMiddleware, requireApproved);

router.get('/ai-events', (req: AuthRequest, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const userId = req.user!.id;
  const broadcaster = getUserBroadcaster(userId);
  const removeFromBroadcaster = broadcaster.add(res);
  const cleanup = () => {
    removeFromBroadcaster();
    releaseUserBroadcaster(userId, broadcaster);
  };

  if (!writeSse(res, 'connected', JSON.stringify({ ok: true }))) {
    cleanup();
    return;
  }

  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
});

router.get('/entries', (req: AuthRequest, res) => {
  const user = requireUser(req);
  log.info(`Listing diary entries for user ${user.id}`);
  const entries = listDiaryEntriesByUser(user.id);
  res.json({ entries });
});

router.get('/entries/:id', (req: AuthRequest, res) => {
  const user = requireUser(req);
  const id = parseWith(idParamSchema, req.params.id);
  log.info(`Fetching diary entry ${id}`);
  const entry = getDiaryEntryById(id);
  if (!entry || entry.userId !== user.id) {
    throw new AppError(404, 'Eintrag nicht gefunden');
  }
  res.json({ entry });
});

router.post('/entries', (req: AuthRequest, res) => {
  const user = requireUser(req);
  const { content, gameDay, arcId } = parseWith(createEntrySchema, req.body);
  if (arcId !== undefined && !getStoryArc(arcId)) {
    throw new AppError(404, 'Story Arc nicht gefunden');
  }

  const entry = createDiaryEntryOncePerDay(user.id, content, gameDay, arcId);
  if (!entry) {
    throw new AppError(409, `Spieltag ${gameDay} existiert bereits`);
  }
  res.status(201).json({ entry });
});

router.put('/entries/:id', (req: AuthRequest, res) => {
  const user = requireUser(req);
  const id = parseWith(idParamSchema, req.params.id);
  log.info(`Update requested for entry ${id}: body keys=${Object.keys(req.body).join(', ')}`);
  const existing = requireOwnEntry(id, user.id);

  const { content, summary, rewrittenContent, arcId } = req.body;
  const updates: Parameters<typeof updateDiaryEntry>[1] = {};
  if (arcId !== undefined) {
    const resolved = parseWith(editableArcIdSchema, arcId);
    if (resolved !== null && !getStoryArc(resolved)) {
      throw new AppError(404, 'Story Arc nicht gefunden');
    }
    updates.arcId = resolved;
  }
  if (content !== undefined) {
    if (typeof content !== 'string' || !content.trim()) {
      throw new AppError(400, 'Inhalt darf nicht leer sein');
    }
    updates.content = content;
    if (existing.rewrittenFilePath || existing.rewrittenContent) {
      updates.rewrittenContent = null;
      updates.rewrittenFilePath = null;
      updates.rewriteSessionId = null;
    }
  }
  if (summary !== undefined) {
    if (
      !(summary === null || summary === undefined
        ? true
        : typeof summary === 'string' && summary.length <= SUMMARY_MAX_LENGTH)
    ) {
      throw new AppError(400, `Zusammenfassung darf maximal ${SUMMARY_MAX_LENGTH} Zeichen haben`);
    }
    updates.summary = summary;
  }
  if (rewrittenContent !== undefined) {
    const clearing = typeof rewrittenContent !== 'string' || !rewrittenContent.trim();
    if (clearing) {
      if (existing.rewrittenFilePath || existing.rewrittenContent) {
        updates.rewrittenContent = null;
        updates.rewrittenFilePath = null;
        updates.rewriteSessionId = null;
      }
    } else {
      updates.rewrittenContent = rewrittenContent;
      if (existing.rewrittenFilePath) {
        updates.rewrittenFilePath = null;
        updates.rewriteSessionId = null;
      }
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
    throw new AppError(500, 'Aktualisieren fehlgeschlagen');
  }
  if (existing.sessionDraftFor && updates.content) {
    recordSessionToDiaryTransfer(existing.sessionDraftFor, user.id, entry.id, true);
  }
  log.info(`Entry ${id} updated`);
  res.json({ entry });
});

router.delete('/entries/:id', (req: AuthRequest, res) => {
  const user = requireUser(req);
  const id = parseWith(idParamSchema, req.params.id);
  log.info(`Delete requested for entry ${id}`);
  const existing = requireOwnEntry(id, user.id);

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

router.post('/entries/:id/rewrite', aiRateLimit, async (req: AuthRequest, res) => {
  const user = requireUser(req);
  requireAiEnabled();

  const id = parseWith(idParamSchema, req.params.id);
  log.info(`Rewrite requested for entry ${id}`);
  const existing = requireOwnEntry(id, user.id);

  const stopProgress = startProgressMessages(user.id, 'KI schreibt den Text um...');
  try {
    const onLog = (line: string) => notifyDiaryAiLog(user.id, line);
    log.info(
      `Calling rewriteTextWithAi for entry ${id}, sessionId=${existing.rewriteSessionId ?? 'none'}`
    );
    const { content: rewritten, sessionId } = await rewriteTextWithAi(
      id,
      existing.content,
      existing.rewrittenContent,
      existing.rewriteSessionId ?? null,
      user,
      undefined,
      onLog
    );
    if (rewritten === null) {
      log.error(`rewriteTextWithAi returned null for entry ${id}`);
      throw new AppError(500, 'KI-Umschreiben ist fehlgeschlagen');
    }

    log.info(`Saving rewritten file path and session for entry ${id}`);
    sendDiaryAiStatus(user.id, 'Ergebnis wird gespeichert...');
    const entry = updateDiaryEntry(id, {
      rewrittenContent: null,
      rewrittenFilePath: getRewrittenFilePath(id),
      rewriteSessionId: sessionId,
    });
    if (!entry) {
      log.error(`Failed to update diary entry ${id}`);
      throw new AppError(500, 'Speichern fehlgeschlagen');
    }
    log.info(`Rewrite completed for entry ${id}`);
    res.json({ entry });
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error(`Unexpected error during rewrite of entry ${id}:`, err);
    throw new AppError(500, 'KI-Umschreiben ist fehlgeschlagen', { cause: err });
  } finally {
    stopProgress();
  }
});

router.post('/entries/:id/rewrite-command', aiRateLimit, async (req: AuthRequest, res) => {
  const user = requireUser(req);
  requireAiEnabled();

  const id = parseWith(idParamSchema, req.params.id);
  const { command } = req.body;
  if (typeof command !== 'string' || !command.trim()) {
    throw new AppError(400, 'Befehl ist erforderlich');
  }

  log.info(`Rewrite command requested for entry ${id}: ${command.trim()}`);
  const existing = requireOwnEntry(id, user.id);
  if (!existing.rewriteSessionId) {
    throw new AppError(400, 'Keine aktive KI-Session vorhanden');
  }
  if (!existing.rewrittenFilePath) {
    throw new AppError(400, 'Keine KI-Version vorhanden');
  }

  const stopProgress = startProgressMessages(user.id, 'KI bearbeitet den Text...');
  try {
    const onLog = (line: string) => notifyDiaryAiLog(user.id, line);
    const { content: rewritten, sessionId } = await improveRewrittenWithCommand(
      id,
      existing.content,
      existing.rewrittenContent || readRewrittenFile(id) || '',
      command.trim(),
      existing.rewriteSessionId,
      user,
      undefined,
      onLog
    );
    if (rewritten === null) {
      log.error(`improveRewrittenWithCommand returned null for entry ${id}`);
      throw new AppError(500, 'KI-Befehl ist fehlgeschlagen');
    }

    sendDiaryAiStatus(user.id, 'Ergebnis wird gespeichert...');
    const entry = updateDiaryEntry(id, {
      rewrittenContent: null,
      rewrittenFilePath: getRewrittenFilePath(id),
      rewriteSessionId: sessionId,
    });
    if (!entry) {
      log.error(`Failed to update diary entry ${id} after command`);
      throw new AppError(500, 'Speichern fehlgeschlagen');
    }
    log.info(`Rewrite command completed for entry ${id}`);
    res.json({ entry });
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error(`Unexpected error during rewrite command of entry ${id}:`, err);
    throw new AppError(500, 'KI-Befehl ist fehlgeschlagen', { cause: err });
  } finally {
    stopProgress();
  }
});

router.post('/entries/:id/summarize', aiRateLimit, async (req: AuthRequest, res) => {
  const user = requireUser(req);
  requireAiEnabled();

  const id = parseWith(idParamSchema, req.params.id);
  const existing = requireOwnEntry(id, user.id);

  const stopProgress = startProgressMessages(user.id, 'KI analysiert den Tagebucheintrag...');
  try {
    const onLog = (line: string) => notifyDiaryAiLog(user.id, line);
    const success = await processDiaryEntryAi(existing.id, user, undefined, onLog);
    if (!success) {
      throw new AppError(500, 'KI-Verarbeitung ist fehlgeschlagen');
    }

    sendDiaryAiStatus(user.id, 'Ergebnisse werden gespeichert...');
    const entry = getDiaryEntryById(id);
    if (!entry) {
      throw new AppError(500, 'Speichern fehlgeschlagen');
    }

    res.json({ entry });
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error(`Unexpected error during summarize of entry ${id}:`, err);
    throw new AppError(500, 'KI-Verarbeitung ist fehlgeschlagen', { cause: err });
  } finally {
    stopProgress();
  }
});

export default router;
