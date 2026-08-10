import { processDiaryEntryAi } from '../ai/rewrite.js';
import { createLogger } from '../logger.js';
import { listDirtyDiaryEntries } from '../repositories/diary.js';

const log = createLogger('diary-summary-scheduler');

export async function processDirtyDiaryEntries() {
  const dirty = listDirtyDiaryEntries();
  if (dirty.length === 0) return;

  log.info(`Processing ${dirty.length} dirty diary entries`);
  for (const entry of dirty) {
    try {
      await processDiaryEntryAi(entry.id, { id: entry.userId });
    } catch (err) {
      log.warn(`Failed to process diary entry ${entry.id}: ${err}`);
    }
  }
  log.info('Finished processing dirty diary entries');
}
