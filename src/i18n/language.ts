import { useSyncExternalStore } from 'react';
import { SUPPORTED_LANGUAGES, type Language, type SafeUser } from '../../shared/types';

export const LANGUAGE_STORAGE_KEY = 'dnd-dashboard-ui-language';
const LEGACY_LANGUAGE_STORAGE_KEYS = [
  'dnd_dashboard.uiLanguage',
  'dnd-dashboard-language',
  'dnd-ui-language',
];

const listeners = new Set<() => void>();
let memoryLanguage: Language | null = null;

export function normalizeLanguage(value: unknown): Language | null {
  if (typeof value !== 'string') return null;
  const primary = value.trim().toLowerCase().split(/[-_]/)[0];
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(primary)
    ? (primary as Language)
    : null;
}

export function getBrowserLanguage(): Language {
  if (typeof navigator !== 'undefined') return normalizeLanguage(navigator.language) ?? 'de';
  return 'de';
}

export function getStoredLanguage(): Language | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    const direct = normalizeLanguage(stored);
    if (direct) return direct;

    for (const key of LEGACY_LANGUAGE_STORAGE_KEYS) {
      const legacy = normalizeLanguage(window.localStorage.getItem(key));
      if (legacy) return legacy;
    }
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }

  return memoryLanguage;
}

function notifyStoredLanguageChanged(): void {
  for (const listener of listeners) listener();
}

export function writeStoredLanguage(language: Language | null): void {
  if (typeof window !== 'undefined') {
    try {
      if (language === null) {
        window.localStorage.removeItem(LANGUAGE_STORAGE_KEY);
        for (const key of LEGACY_LANGUAGE_STORAGE_KEYS) window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
      }
      memoryLanguage = null;
    } catch {
      memoryLanguage = language;
      // The in-memory provider state still works when storage is blocked.
    }
  } else {
    memoryLanguage = language;
  }
  notifyStoredLanguageChanged();
}

export function subscribeToStoredLanguage(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === null ||
      event.key === LANGUAGE_STORAGE_KEY ||
      LEGACY_LANGUAGE_STORAGE_KEYS.includes(event.key)
    ) {
      listener();
    }
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

export function useStoredLanguage(): Language | null {
  return useSyncExternalStore(subscribeToStoredLanguage, getStoredLanguage, () => null);
}

export function getAnonymousLanguage(
  storedLanguage: Language | null = getStoredLanguage(),
  browserLanguage: Language = getBrowserLanguage()
): Language {
  return storedLanguage ?? browserLanguage;
}

type LanguageBearingUser = Pick<SafeUser, 'uiLanguage'> | null | undefined;

/** Resolve the simulated account first, then the real account, then anonymous selection. */
export function getEffectiveLanguage(
  viewAsUser: LanguageBearingUser,
  user: LanguageBearingUser,
  anonymousLanguage: Language
): Language {
  if (viewAsUser) return normalizeLanguage(viewAsUser.uiLanguage) ?? anonymousLanguage;
  if (user) return normalizeLanguage(user.uiLanguage) ?? anonymousLanguage;
  return anonymousLanguage;
}
