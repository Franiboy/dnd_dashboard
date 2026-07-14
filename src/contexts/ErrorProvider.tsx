import { useCallback, useState, type ReactNode } from 'react';
import { ErrorContext } from './ErrorContext';
import { Toast } from '../components/Toast';

export function ErrorProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<string | null>(null);

  const showError = useCallback((message: string) => {
    setError((prev) => (prev === message ? prev : message));
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return (
    <ErrorContext.Provider value={{ error, showError, clearError }}>
      {children}
      <Toast message={error} onClose={clearError} />
    </ErrorContext.Provider>
  );
}
