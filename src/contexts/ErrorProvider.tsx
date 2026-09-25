import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ErrorContext, type ToastType } from './ErrorContext';
import { Toast } from '../components/Toast';
import { getBrowserLanguage, getStoredLanguage, normalizeLanguage } from '../i18n/language';
import { createTranslator } from '../i18n/messages';
import { localizeServerMessage } from '../i18n/serverMessages';

function getCurrentLanguage() {
  if (typeof document !== 'undefined') {
    const documentLanguage = normalizeLanguage(document.documentElement.lang);
    if (documentLanguage) return documentLanguage;
  }
  return getStoredLanguage() ?? getBrowserLanguage();
}

/**
 * ErrorProvider is mounted above I18nProvider so auth bootstrap errors can be
 * reported before the full context exists. Resolve the document language at
 * call time; new toasts therefore use the current language after a switch.
 */
export function ErrorProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  const show = useCallback((message: string, type: ToastType) => {
    setToast((prev) =>
      prev?.message === message && prev?.type === type ? prev : { message, type }
    );
  }, []);

  const localize = useCallback((message: string) => {
    const language = getCurrentLanguage();
    return (
      localizeServerMessage(message, createTranslator(language), { fallback: message }) ?? message
    );
  }, []);

  const showError = useCallback(
    (message: string) => show(localize(message), 'error'),
    [localize, show]
  );
  const showInfo = useCallback(
    (message: string) => show(localize(message), 'info'),
    [localize, show]
  );
  const showSuccess = useCallback(
    (message: string) => show(localize(message), 'success'),
    [localize, show]
  );

  const clearError = useCallback(() => {
    setToast(null);
  }, []);

  const value = useMemo(
    () => ({ toast, showError, showInfo, showSuccess, clearError }),
    [toast, showError, showInfo, showSuccess, clearError]
  );

  return (
    <ErrorContext.Provider value={value}>
      {children}
      <Toast message={toast?.message ?? null} type={toast?.type} onClose={clearError} />
    </ErrorContext.Provider>
  );
}
