import type { Language } from '../../shared/types.js';
import { getAiSettings } from '../repositories/aiSettings.js';
import { normalizeAiLanguage } from './promptLanguage.js';

function isMissingAiSettingsSchema(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /no such table: ai_settings|no such column: language/i.test(error.message);
}

/**
 * Reads the persisted global language for the current process. Imports can
 * happen briefly before runMigrations() has created the settings table or its
 * language column, so that bootstrap window uses the validated de/en
 * WHISPER_LANGUAGE fallback. Once the schema is available, the database value
 * is authoritative and this environment value is ignored.
 */
export function getAiLanguage(): Language {
  try {
    return getAiSettings().language;
  } catch (error) {
    if (isMissingAiSettingsSchema(error)) {
      return normalizeAiLanguage(process.env.WHISPER_LANGUAGE);
    }
    throw error;
  }
}
