import { SUPPORTED_LANGUAGES, type Language } from '../../shared/types';
import { de } from './locales/de';
import { en } from './locales/en';
import type { MessageTree, MessageValue, PluralMessage, TranslationValues } from './types';

export const locales: Record<Language, MessageTree> = { de, en };

type LeafMessage = string | PluralMessage;
type TranslationPath<T> = T extends LeafMessage
  ? never
  : {
      [K in keyof T & string]: T[K] extends LeafMessage ? K : `${K}.${TranslationPath<T[K]>}`;
    }[keyof T & string];

export type TranslationKey = TranslationPath<typeof de>;
export interface TFunction {
  <Key extends TranslationKey>(key: Key, values?: TranslationValues): string;
  /** Language used by the translator, when it was created by createTranslator. */
  language?: Language;
}

const localeTags: Record<Language, string> = {
  de: 'de-DE',
  en: 'en-US',
};

function isPluralMessage(value: unknown): value is PluralMessage {
  return typeof value === 'object' && value !== null && 'other' in value;
}

function findMessage(messages: MessageTree, key: string): MessageValue | undefined {
  let current: unknown = messages;

  for (const part of key.split('.')) {
    if (typeof current !== 'object' || current === null || isPluralMessage(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  if (typeof current === 'string' || isPluralMessage(current)) return current;
  return undefined;
}

function selectPluralPattern(message: PluralMessage, language: Language, count: unknown): string {
  const numericCount =
    typeof count === 'number'
      ? count
      : typeof count === 'string' && count.trim() !== ''
        ? Number(count)
        : NaN;
  if (!Number.isFinite(numericCount)) return message.other;

  const category = new Intl.PluralRules(localeTags[language]).select(numericCount);
  const variant = message[category];
  return variant ?? message.other;
}

function interpolate(pattern: string, values: TranslationValues, language: Language): string {
  return pattern.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => {
    const value = values[name];
    if (value === null || value === undefined) return match;
    if (typeof value === 'number') return new Intl.NumberFormat(localeTags[language]).format(value);
    return String(value);
  });
}

function resolvePattern(
  value: MessageValue | undefined,
  language: Language,
  values: TranslationValues
): string | undefined {
  if (typeof value === 'string') return value;
  if (!value) return undefined;
  return selectPluralPattern(value, language, values.count);
}

export function translate(
  language: Language,
  key: TranslationKey | (string & {}),
  values: TranslationValues = {}
): string {
  const fallbackLanguages: Language[] = language === 'de' ? ['de', 'en'] : ['en', 'de'];

  for (const candidate of fallbackLanguages) {
    const pattern = resolvePattern(findMessage(locales[candidate], key), candidate, values);
    if (pattern !== undefined) return interpolate(pattern, values, candidate);
  }

  return key;
}

export function createTranslator(language: Language): TFunction {
  const translator = ((key: TranslationKey, values?: TranslationValues) =>
    translate(language, key, values)) as TFunction;
  return Object.assign(translator, { language });
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}
