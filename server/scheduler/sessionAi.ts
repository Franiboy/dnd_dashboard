import { improveSessionTranscriptWithAi } from '../ai/sessionRewrite.js';
import { processSessionSummaryEntities } from '../ai/sessionSummary.js';
import { createLogger } from '../logger.js';
import { getSessionById, listSessionsPendingAi } from '../repositories/recordings.js';
import type { McpSessionUser } from '../mcp/tokens.js';

const log = createLogger('session-ai-scheduler');

const SCHEDULER_USER: McpSessionUser = { id: 'scheduler', isAdmin: true };

function sessionNeedsImprovement(session: { transcriptImprovedAt: string | null }): boolean {
  return !session.transcriptImprovedAt;
}

function sessionNeedsSummary(session: {
  transcriptImprovedAt: string | null;
  longSummary: string | null;
  longSummaryGeneratedAt: string | null;
}): boolean {
  if (!session.transcriptImprovedAt) return false;
  if (!session.longSummary) return true;
  if (!session.longSummaryGeneratedAt) return true;
  return session.longSummaryGeneratedAt < session.transcriptImprovedAt;
}

async function processSession(id: number): Promise<void> {
  let session = getSessionById(id);
  if (!session || !session.transcript) {
    log.warn(`Session ${id} not found or has no transcript`);
    return;
  }

  if (sessionNeedsImprovement(session)) {
    log.info(`Improving transcript for session ${id}`);
    const result = await improveSessionTranscriptWithAi(id, SCHEDULER_USER, undefined);
    if (result.transcript === null) {
      log.warn(`Transcript improvement failed or produced no changes for session ${id}`);
      return;
    }
    session = getSessionById(id);
    if (!session || !session.transcript) {
      log.warn(`Session ${id} disappeared after transcript improvement`);
      return;
    }
  }

  if (sessionNeedsSummary(session)) {
    log.info(`Generating summaries for session ${id}`);
    await processSessionSummaryEntities(id, SCHEDULER_USER, undefined);
  } else {
    log.info(`Session ${id} already has up-to-date summaries`);
  }
}

export async function processPendingSessions(): Promise<void> {
  const pending = listSessionsPendingAi();
  const needsWork = pending.filter((s) => sessionNeedsImprovement(s) || sessionNeedsSummary(s));
  if (needsWork.length === 0) {
    log.info('No sessions pending AI processing');
    return;
  }

  log.info(`Processing ${needsWork.length} session(s) pending AI`);
  for (const { id } of needsWork) {
    try {
      await processSession(id);
    } catch (err) {
      log.error(`Failed to process session ${id}:`, err);
    }
  }
  log.info('Finished processing pending sessions');
}
