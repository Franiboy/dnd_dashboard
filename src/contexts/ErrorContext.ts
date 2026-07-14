import { createContext } from 'react';

export type ToastType = 'error' | 'info' | 'success';

export interface ToastState {
  message: string;
  type: ToastType;
}

export interface ErrorContextValue {
  toast: ToastState | null;
  showError: (message: string) => void;
  showInfo: (message: string) => void;
  showSuccess: (message: string) => void;
  clearError: () => void;
}

export const ErrorContext = createContext<ErrorContextValue | null>(null);
