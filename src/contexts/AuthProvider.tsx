import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useError } from '../hooks/useError';
import { AuthContext, type AuthCallbackResult } from '../hooks/useAuth';
import type { SafeUser } from '../../shared/types';
import { getBrowserLanguage, getEffectiveLanguage, useStoredLanguage } from '../i18n/language';
import { createTranslator, type TranslationKey } from '../i18n/messages';
import {
  getServerMessageCode,
  getServerMessageKey,
  localizeServerMessage,
  type ServerMessageLike,
} from '../i18n/serverMessages';

interface AuthProviderProps {
  children: ReactNode;
}

type AuthErrorState =
  | { kind: 'key'; key: TranslationKey; params?: ServerMessageLike['params'] }
  | { kind: 'message'; message: string };

interface AuthErrorResponse {
  error?: string;
  message?: string;
  errorCode?: string;
  messageKey?: string;
  params?: ServerMessageLike['params'];
}

function responsePayload(data: AuthErrorResponse): ServerMessageLike | null {
  if (
    typeof data.error !== 'string' &&
    typeof data.message !== 'string' &&
    typeof data.errorCode !== 'string' &&
    typeof data.messageKey !== 'string'
  ) {
    return null;
  }
  return {
    message: data.message ?? data.error,
    error: data.error ?? data.message,
    errorCode: data.errorCode,
    messageKey: data.messageKey,
    params: data.params,
  };
}

function makeErrorState(
  message: string | ServerMessageLike | null | undefined,
  fallbackKey: TranslationKey
): AuthErrorState {
  if (!message) return { kind: 'key', key: fallbackKey };
  if (typeof message === 'string') {
    const key = getServerMessageKey(message);
    return key ? { kind: 'key', key } : { kind: 'message', message };
  }
  const key = getServerMessageKey(message);
  if (key) return { kind: 'key', key, params: message.params };
  // A structured code is intentionally not guessed from its fallback text.
  if (getServerMessageCode(message))
    return { kind: 'key', key: fallbackKey, params: message.params };
  return typeof message.message === 'string'
    ? { kind: 'message', message: message.message }
    : { kind: 'key', key: fallbackKey };
}

function resolveError(
  state: AuthErrorState | null,
  t: ReturnType<typeof createTranslator>
): string | null {
  if (!state) return null;
  if (state.kind === 'message') return state.message;
  return (
    localizeServerMessage({ messageKey: state.key, params: state.params }, t, {
      fallbackKey: state.key,
      fallback: t(state.key, state.params),
    }) ?? t(state.key, state.params)
  );
}

export function AuthProvider({ children }: AuthProviderProps) {
  const { showError } = useError();
  const [user, setUser] = useState<SafeUser | null>(null);
  const [viewAsUser, setViewAsUser] = useState<SafeUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorState, setErrorState] = useState<AuthErrorState | null>(null);
  const effectiveUser = viewAsUser ?? user;
  // I18nProvider is nested below this provider, so auth errors use the same
  // shared language resolver until that context is available to descendants.
  const storedLanguage = useStoredLanguage();
  const language = getEffectiveLanguage(viewAsUser, user, storedLanguage ?? getBrowserLanguage());
  const t = useMemo(() => createTranslator(language), [language]);
  const error = resolveError(errorState, t);

  const setError = useCallback((message: string | null) => {
    if (!message) {
      setErrorState(null);
      return;
    }
    setErrorState(makeErrorState(message, 'auth.loginFailed'));
  }, []);

  const reportError = useCallback(
    (
      message: string | ServerMessageLike | null | undefined,
      fallbackKey: TranslationKey
    ): string => {
      const next = makeErrorState(message, fallbackKey);
      const resolved = resolveError(next, t) ?? t(fallbackKey);
      setErrorState(next);
      showError(resolved);
      return resolved;
    },
    [showError, t]
  );

  const loginAdmin = useCallback(
    async (username: string, password: string): Promise<boolean> => {
      try {
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
          credentials: 'include',
        });
        const data = (await res.json()) as AuthErrorResponse & { user?: SafeUser };
        if (res.ok && data.user) {
          setUser(data.user);
          setErrorState(null);
          return true;
        }
        reportError(responsePayload(data), 'auth.loginFailed');
        return false;
      } catch {
        reportError(null, 'common.serverUnavailable');
        return false;
      }
    },
    [reportError]
  );

  const handleDiscordCallback = useCallback(
    async (code: string, state: string): Promise<AuthCallbackResult> => {
      try {
        const res = await fetch('/api/auth/discord/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, state }),
          credentials: 'include',
        });
        const data = (await res.json()) as AuthErrorResponse & { user?: SafeUser };
        if (res.ok && data.user) {
          setUser(data.user);
          setErrorState(null);
          return { ok: true };
        }
        if (res.status === 403 && data.user) {
          setUser(data.user);
          const pendingPayload = responsePayload(data);
          const pendingError = makeErrorState(pendingPayload, 'auth.accountPending');
          setErrorState(pendingError);
          return {
            ok: false,
            pending: true,
            message: resolveError(pendingError, t) ?? t('auth.accountPending'),
            ...(getServerMessageCode(pendingPayload)
              ? { errorCode: getServerMessageCode(pendingPayload) }
              : {}),
            ...(getServerMessageKey(pendingPayload)
              ? { messageKey: getServerMessageKey(pendingPayload) }
              : {}),
            ...(pendingPayload?.params !== undefined ? { params: pendingPayload.params } : {}),
          };
        }
        const payload = responsePayload(data);
        return {
          ok: false,
          message: reportError(payload, 'auth.discordLoginFailed'),
          ...(getServerMessageCode(payload) ? { errorCode: getServerMessageCode(payload) } : {}),
          ...(getServerMessageKey(payload) ? { messageKey: getServerMessageKey(payload) } : {}),
          ...(payload?.params !== undefined ? { params: payload.params } : {}),
        };
      } catch {
        return { ok: false, message: reportError(null, 'common.serverUnavailable') };
      }
    },
    [reportError, t]
  );

  const startDiscordLogin = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch('/api/auth/discord', { credentials: 'include' });
      const data = (await res.json()) as AuthErrorResponse & { url?: string };
      if (res.ok && data.url) return data.url;
      reportError(responsePayload(data), 'auth.discordLoginUnavailable');
      return null;
    } catch {
      reportError(null, 'common.serverUnavailable');
      return null;
    }
  }, [reportError]);

  const logout = useCallback(async () => {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
    setViewAsUser(null);
    setErrorState(null);
  }, []);

  const updateUser = useCallback((updates: Partial<SafeUser>) => {
    setUser((prev) => (prev ? { ...prev, ...updates } : prev));
  }, []);

  const checkApproved = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/me', { credentials: 'include' });
      if (!res.ok) return false;
      const data = (await res.json()) as { user?: SafeUser & { isApproved: boolean } };
      if (data.user?.isApproved) {
        setUser(data.user);
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }, []);

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch('/api/me', { credentials: 'include' });
      if (res.ok) {
        const data = (await res.json()) as { user?: SafeUser };
        setUser(data.user ?? null);
        setErrorState(null);
        setLoading(false);
        return;
      }
    } catch {
      setUser(null);
      setLoading(false);
      return;
    }
    // Without an existing session, local development setups may sign in as
    // the initial admin automatically; the endpoint only exists when the
    // server explicitly enables it.
    try {
      const versionRes = await fetch('/api/version');
      if (versionRes.ok) {
        const version = await versionRes.json();
        if (version.devAutoLogin) {
          const devRes = await fetch('/api/auth/dev-session', {
            method: 'POST',
            credentials: 'include',
          });
          if (devRes.ok) {
            const data = (await devRes.json()) as { user?: SafeUser };
            setUser(data.user ?? null);
            setErrorState(null);
          }
        }
      }
    } catch {
      setUser(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // Session bootstrap from cookies/dev-session; fetchMe owns its state
    // transitions along the async flow.
    // oxlint-disable-next-line react/set-state-in-effect
    fetchMe();
  }, [fetchMe]);

  const value = useMemo(
    () => ({
      user,
      effectiveUser,
      viewAsUser,
      setViewAsUser,
      clearViewAsUser: () => setViewAsUser(null),
      loading,
      error,
      loginAdmin,
      handleDiscordCallback,
      startDiscordLogin,
      logout,
      checkApproved,
      updateUser,
      setError,
    }),
    [
      user,
      effectiveUser,
      viewAsUser,
      loading,
      error,
      loginAdmin,
      handleDiscordCallback,
      startDiscordLogin,
      logout,
      checkApproved,
      updateUser,
      setError,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
