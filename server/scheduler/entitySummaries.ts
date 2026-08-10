import { generateEntitySummary } from '../ai/knowledge.js';
import { createLogger } from '../logger.js';
import { listDirtyEntitySummaries } from '../repositories/entitySummaries.js';

const log = createLogger('entity-summary-scheduler');

export async function processDirtySummaries() {
  const dirty = listDirtyEntitySummaries();
  if (dirty.length === 0) return;

  log.info(`Processing ${dirty.length} dirty entity summaries`);
  for (const { entityType, entityName } of dirty) {
    try {
      await generateEntitySummary(entityType, entityName);
    } catch (err) {
      log.warn(`Failed to generate summary for ${entityType}/${entityName}: ${err}`);
    }
  }
  log.info('Finished processing dirty entity summaries');
}
