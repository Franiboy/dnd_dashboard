import { useCallback, useState, type ReactNode } from 'react';
import { ErrorContext, type ToastType } from './ErrorContext';
import { Toast } from '../components/Toast';

export function ErrorProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  const show = useCallback((message: string, type: ToastType) => {
    setToast((prev) => (prev?.message === message && prev?.type === type ? prev : { message, type }));
  }, []);

  const showError = useCallback((message: string) => show(message, 'error'), [show]);
  const showInfo = useCallback((message: string) => show(message, 'info'), [show]);
  const showSuccess = useCallback((message: string) => show(message, 'success'), [show]);

  const clearError = useCallback(() => {
    setToast(null);
  }, []);

  return (
    <ErrorContext.Provider value={{ toast, showError, showInfo, showSuccess, clearError }}>
      {children}
      <Toast message={toast?.message ?? null} type={toast?.type} onClose={clearError} />
    </ErrorContext.Provider>
  );
}
