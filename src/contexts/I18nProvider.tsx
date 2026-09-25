import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Language } from '../../shared/types';
import { useAuth } from '../hooks/useAuth';
import { useError } from '../hooks/useError';
import {
  formatDateTimeValue,
  formatDateValue,
  formatNumberValue,
  formatTimeValue,
} from '../i18n/format';
import { I18nContext, type I18nContextValue } from '../i18n/I18nContext';
import {
  getBrowserLanguage,
  getEffectiveLanguage,
  normalizeLanguage,
  useStoredLanguage,
  writeStoredLanguage,
} from '../i18n/language';
import { createTranslator } from '../i18n/messages';

interface I18nProviderProps {
  children: ReactNode;
}

export function I18nProvider({ children }: I18nProviderProps) {
  const { user, viewAsUser, updateUser } = useAuth();
  const { showError } = useError();
  const storedLanguage = useStoredLanguage();
  const synchronizedUserRef = useRef<string | null>(null);
  const accountSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const currentUserIdRef = useRef<string | null>(user?.id ?? null);
  const [optimistic, setOptimistic] = useState<{
    userId: string;
    language: Language | null;
  } | null>(null);

  const anonymousLanguage = storedLanguage ?? getBrowserLanguage();
  const accountOverride = viewAsUser
    ? undefined
    : optimistic && optimistic.userId === user?.id
      ? optimistic.language
      : undefined;
  const language =
    accountOverride === undefined
      ? getEffectiveLanguage(viewAsUser, user, anonymousLanguage)
      : (accountOverride ?? anonymousLanguage);
  const accountLanguage = viewAsUser ? viewAsUser.uiLanguage : user?.uiLanguage;
  const languagePreference =
    optimistic && optimistic.userId === user?.id && !viewAsUser
      ? optimistic.language
      : accountLanguage === undefined
        ? storedLanguage
        : normalizeLanguage(accountLanguage);
  const locale = language === 'de' ? 'de-DE' : 'en-US';
  const t = useMemo(() => createTranslator(language), [language]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    currentUserIdRef.current = user?.id ?? null;
  }, [user?.id]);

  const setLanguage = useCallback(
    async (nextLanguage: Language | null) => {
      const languageToSave =
        nextLanguage === null ? null : (normalizeLanguage(nextLanguage) ?? 'de');
      writeStoredLanguage(languageToSave);

      // The authenticated user always refers to the real account, never to an
      // account currently opened through admin simulation.
      if (!user) return;

      const userId = user.id;
      setOptimistic({ userId, language: languageToSave });

      const save = async () => {
        if (currentUserIdRef.current !== userId) {
          setOptimistic((current) => (current?.userId === userId ? null : current));
          return;
        }

        try {
          const response = await fetch('/api/me/ui-language', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ language: languageToSave }),
            credentials: 'include',
          });
          const data = (await response.json()) as {
            user?: { uiLanguage?: Language | null };
          };
          if (!response.ok) throw new Error('language-save-failed');
          const savedLanguage =
            data.user?.uiLanguage === null
              ? null
              : (normalizeLanguage(data.user?.uiLanguage) ?? languageToSave);
          if (currentUserIdRef.current === userId) {
            updateUser({ uiLanguage: savedLanguage });
          }
        } catch {
          if (currentUserIdRef.current === userId) {
            // Pass the stable key so ErrorProvider resolves it in the current UI language.
            showError('common.languageSaveError');
          }
        } finally {
          setOptimistic((current) =>
            current?.userId === userId && current.language === languageToSave ? null : current
          );
        }
      };

      const queuedSave = accountSaveQueueRef.current.then(save, save);
      accountSaveQueueRef.current = queuedSave.catch(() => undefined);
      await queuedSave;
    },
    [showError, updateUser, user]
  );

  useEffect(() => {
    if (
      !user ||
      viewAsUser ||
      user.uiLanguage !== null ||
      storedLanguage === null ||
      synchronizedUserRef.current === user.id
    ) {
      return;
    }
    synchronizedUserRef.current = user.id;
    void setLanguage(storedLanguage);
  }, [setLanguage, storedLanguage, user, viewAsUser]);

  const formatDate = useCallback(
    (value: Parameters<I18nContextValue['formatDate']>[0], options?: Intl.DateTimeFormatOptions) =>
      formatDateValue(language, value, options),
    [language]
  );
  const formatTime = useCallback(
    (value: Parameters<I18nContextValue['formatTime']>[0], options?: Intl.DateTimeFormatOptions) =>
      formatTimeValue(language, value, options),
    [language]
  );
  const formatDateTime = useCallback(
    (
      value: Parameters<I18nContextValue['formatDateTime']>[0],
      options?: Intl.DateTimeFormatOptions
    ) => formatDateTimeValue(language, value, options),
    [language]
  );
  const formatNumber = useCallback(
    (value: Parameters<I18nContextValue['formatNumber']>[0], options?: Intl.NumberFormatOptions) =>
      formatNumberValue(language, value, options),
    [language]
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      languagePreference,
      locale,
      t,
      setLanguage,
      formatDate,
      formatTime,
      formatDateTime,
      formatNumber,
    }),
    [
      formatDate,
      formatDateTime,
      formatNumber,
      formatTime,
      language,
      languagePreference,
      locale,
      setLanguage,
      t,
    ]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
