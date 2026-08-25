import { generateEntitySummary } from '../ai/knowledge.js';
import { createLogger } from '../logger.js';
import { listDirtyEntitySummaries } from '../repositories/entitySummaries.js';

const log = createLogger('entity-summary-scheduler');

export async function processDirtySummaries() {
  const dirty = listDirtyEntitySummaries();
  if (dirty.length === 0) return;

  log.info(`Processing ${dirty.length} dirty entity summaries`);
  for (const { entityType, entityName, entityQualifier } of dirty) {
    const qualified = entityQualifier ? `${entityName} (${entityQualifier})` : entityName;
    try {
      await generateEntitySummary(entityType, entityName, { qualifier: entityQualifier });
    } catch (err) {
      log.warn(`Failed to generate summary for ${entityType}/${qualified}: ${err}`);
    }
  }
  log.info('Finished processing dirty entity summaries');
}
