import { db } from '../database.js';

export interface AiModelSettings {
  normalModel: string | null;
  cheapModel: string | null;
}

export function getAiModelSettings(): AiModelSettings {
  const row = db.prepare('SELECT normal_model, cheap_model FROM ai_settings WHERE id = 1').get() as
    { normal_model: string | null; cheap_model: string | null } | undefined;
  return {
    normalModel: row?.normal_model ?? null,
    cheapModel: row?.cheap_model ?? null,
  };
}

export function setAiModelSettings(
  normalModel: string | null,
  cheapModel: string | null
): AiModelSettings {
  db.prepare(
    `INSERT INTO ai_settings (id, normal_model, cheap_model, updated_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       normal_model = excluded.normal_model,
       cheap_model = excluded.cheap_model,
       updated_at = excluded.updated_at`
  ).run(normalModel, cheapModel, new Date().toISOString());
  return getAiModelSettings();
}
