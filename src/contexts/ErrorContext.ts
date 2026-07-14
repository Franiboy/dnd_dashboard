import { createContext } from 'react';

export interface ErrorContextValue {
  error: string | null;
  showError: (message: string) => void;
  clearError: () => void;
}

export const ErrorContext = createContext<ErrorContextValue | null>(null);
