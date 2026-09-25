import type { Language, WhisperLanguage } from '../../shared/types.js';

export type { WhisperLanguage } from '../../shared/types.js';

export const AI_OUTPUT_LANGUAGE_ENV = 'AI_OUTPUT_LANGUAGE';
export const DEFAULT_AI_LANGUAGE: Language = 'de';

/** Returns a supported AI output language and safely falls back to German. */
export function normalizeAiLanguage(value: unknown): Language {
  return value === 'en' || value === 'de' ? value : DEFAULT_AI_LANGUAGE;
}

/** Preserves the legacy Whisper `auto` value while normalizing all other input. */
export function normalizeWhisperLanguage(value: unknown): WhisperLanguage {
  return value === 'auto' ? 'auto' : normalizeAiLanguage(value);
}

/** Reads the language supplied to a model or MCP process for this run. */
export function getAiOutputLanguage(): Language {
  return normalizeAiLanguage(process.env[AI_OUTPUT_LANGUAGE_ENV]);
}

/** Selects the complete variant used in a prompt or model-facing message. */
export function localize(language: Language, german: string, english: string): string {
  return language === 'en' ? english : german;
}

/** Selects parallel line collections without mixing languages within a prompt. */
export function localizeLines(
  language: Language,
  german: readonly string[],
  english: readonly string[]
): string[] {
  return (language === 'en' ? english : german).slice();
}

/** Explicit output contract shared by every model-facing prompt. */
export function outputLanguageInstruction(language: Language): string {
  return localize(
    language,
    'Sprachregel: Alle von dir erzeugten Inhalte müssen auf Deutsch verfasst werden. Quelltexte können in einer anderen Sprache vorliegen; technische Namen, Toolnamen, JSON-/HTML-Strukturen, Entity-Namen und Nutzerbefehle bleiben unverändert.',
    'Language rule: All content you generate must be written in English. Source text may be in another language; technical names, tool names, JSON/HTML structures, entity names, and user commands must remain unchanged.'
  );
}
