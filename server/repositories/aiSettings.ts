import { SUPPORTED_LANGUAGES, type Language } from '../../shared/types.js';
import { db } from '../database.js';

export interface AiSettings {
  model: string | null;
  language: Language;
}

export type AiModelSettings = AiSettings;

function normalizeLanguage(value: unknown): Language {
  return typeof value === 'string' && SUPPORTED_LANGUAGES.includes(value as Language)
    ? (value as Language)
    : 'de';
}

export function getAiSettings(): AiSettings {
  const row = db.prepare('SELECT model, language FROM ai_settings WHERE id = 1').get() as
    { model: unknown; language: unknown } | undefined;
  return {
    model: typeof row?.model === 'string' ? row.model : null,
    language: normalizeLanguage(row?.language),
  };
}

export function getAiModelSettings(): AiSettings {
  return getAiSettings();
}

export function setAiModelSettings(model: string | null): AiSettings {
  db.prepare(
    `INSERT INTO ai_settings (id, model, updated_at)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       model = excluded.model,
       updated_at = excluded.updated_at`
  ).run(model, new Date().toISOString());
  return getAiSettings();
}

export function setAiLanguageSettings(language: Language): AiSettings {
  db.prepare(
    `INSERT INTO ai_settings (id, language, updated_at)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       language = excluded.language,
       updated_at = excluded.updated_at`
  ).run(language, new Date().toISOString());
  return getAiSettings();
}
