import { db } from '../database.js';

export interface AiModelSettings {
  model: string | null;
}

export function getAiModelSettings(): AiModelSettings {
  const row = db.prepare('SELECT model FROM ai_settings WHERE id = 1').get() as
    { model: string | null } | undefined;
  return {
    model: row?.model ?? null,
  };
}

export function setAiModelSettings(model: string | null): AiModelSettings {
  db.prepare(
    `INSERT INTO ai_settings (id, model, updated_at)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       model = excluded.model,
       updated_at = excluded.updated_at`
  ).run(model, new Date().toISOString());
  return getAiModelSettings();
}
