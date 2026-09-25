import { createContext, useContext } from 'react';
import type { SafeUser, ServerMessageParams } from '../../shared/types';

export interface AuthCallbackResult {
  ok: boolean;
  pending?: boolean;
  /** Legacy fallback retained for callers that only render text. */
  message?: string;
  error?: string;
  messageKey?: string | null;
  errorCode?: string | null;
  params?: ServerMessageParams;
}

export interface AuthContextValue {
  user: SafeUser | null;
  effectiveUser: SafeUser | null;
  viewAsUser: SafeUser | null;
  setViewAsUser: (user: SafeUser | null) => void;
  clearViewAsUser: () => void;
  loading: boolean;
  error: string | null;
  loginAdmin: (username: string, password: string) => Promise<boolean>;
  handleDiscordCallback: (code: string, state: string) => Promise<AuthCallbackResult>;
  startDiscordLogin: () => Promise<string | null>;
  logout: () => Promise<void>;
  checkApproved: () => Promise<boolean>;
  updateUser: (updates: Partial<SafeUser>) => void;
  setError: (error: string | null) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
