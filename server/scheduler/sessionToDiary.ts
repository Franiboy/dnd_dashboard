import { createLogger } from '../logger.js';
import { generateSessionDiaryDraft } from '../ai/sessionToDiary.js';
import { updateDiaryEntry } from '../repositories/diary.js';
import {
  listPendingSessionToDiaryTransfers,
  recordSessionToDiaryTransfer,
} from '../repositories/recordings.js';
import { getUsersWithAutoSessionToDiary } from '../users.js';
import type { McpSessionUser } from '../mcp/tokens.js';
import type { SafeUser } from '../../shared/types.js';

const log = createLogger('session-to-diary-scheduler');

function toMcpUser(user: SafeUser): McpSessionUser {
  return {
    id: user.id,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
    activePerson: user.activePerson,
  };
}

async function processUserSession(
  user: SafeUser,
  sessionId: number,
  sessionName: string,
): Promise<void> {
  const sessionUser = toMcpUser(user);
  log.info(`Transferring session ${sessionId} (${sessionName}) to diary for user ${user.id}`);

  const entry = await generateSessionDiaryDraft(sessionId, sessionUser);
  if (!entry) {
    log.warn(`Failed to generate session-to-diary draft for session ${sessionId}, user ${user.id}`);
    return;
  }

  if (user.autoAcceptSessionDiary && entry.rewrittenContent) {
    const updated = updateDiaryEntry(entry.id, {
      content: entry.rewrittenContent,
      rewrittenContent: null,
      rewrittenFilePath: null,
      rewriteSessionId: null,
      sessionDraftFor: null,
    });
    if (!updated) {
      log.error(`Failed to auto-accept session-to-diary draft for entry ${entry.id}`);
      return;
    }
    recordSessionToDiaryTransfer(sessionId, user.id, entry.id, true);
    log.info(`Auto-accepted session ${sessionId} as diary entry ${entry.id} for user ${user.id}`);
  } else {
    recordSessionToDiaryTransfer(sessionId, user.id, entry.id, false);
    log.info(`Stored session ${sessionId} as KI draft for entry ${entry.id}, user ${user.id}`);
  }
}

export async function processSessionToDiary(): Promise<void> {
  const users = getUsersWithAutoSessionToDiary();
  if (users.length === 0) {
    log.info('No users with automatic session-to-diary transfer enabled');
    return;
  }

  log.info(`Processing session-to-diary transfers for ${users.length} user(s)`);
  for (const user of users) {
    const pending = listPendingSessionToDiaryTransfers(user.id);
    if (pending.length === 0) {
      log.info(`No pending sessions for user ${user.id}`);
      continue;
    }

    log.info(`Found ${pending.length} pending session(s) for user ${user.id}`);
    for (const session of pending) {
      try {
        await processUserSession(user, session.id, session.name);
      } catch (err) {
        log.error(`Failed to process session ${session.id} for user ${user.id}:`, err);
      }
    }
  }
  log.info('Finished session-to-diary transfers');
}
