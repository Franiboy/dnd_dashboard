import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useError } from '../hooks/useError';
import { AuthContext } from '../hooks/useAuth';
import type { SafeUser } from '../../shared/types';

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const { showError } = useError();
  const [user, setUser] = useState<SafeUser | null>(null);
  const [viewAsUser, setViewAsUser] = useState<SafeUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const effectiveUser = viewAsUser ?? user;

  const loginAdmin = useCallback(
    async (username: string, password: string): Promise<boolean> => {
      try {
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
          credentials: 'include',
        });
        const data = await res.json();
        if (res.ok) {
          setUser(data.user);
          setError(null);
          return true;
        }
        setError(data.error || 'Login fehlgeschlagen');
        showError(data.error || 'Login fehlgeschlagen');
        return false;
      } catch {
        setError('Server nicht erreichbar');
        showError('Server nicht erreichbar');
        return false;
      }
    },
    [showError]
  );

  const handleDiscordCallback = useCallback(
    async (
      code: string,
      state: string
    ): Promise<{ ok: boolean; pending?: boolean; message?: string }> => {
      try {
        const res = await fetch('/api/auth/discord/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, state }),
          credentials: 'include',
        });
        const data = await res.json();
        if (res.ok) {
          setUser(data.user);
          setError(null);
          return { ok: true };
        }
        if (res.status === 403 && data.user) {
          setUser(data.user);
          return {
            ok: false,
            pending: true,
            message: data.error || 'Account wurde noch nicht freigegeben',
          };
        }
        const message = data.error || 'Discord Login fehlgeschlagen';
        setError(message);
        showError(message);
        return { ok: false, message };
      } catch {
        setError('Server nicht erreichbar');
        showError('Server nicht erreichbar');
        return { ok: false };
      }
    },
    [showError]
  );

  const startDiscordLogin = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch('/api/auth/discord', { credentials: 'include' });
      const data = await res.json();
      if (res.ok) return data.url;
      setError(data.error || 'Discord Login nicht verfügbar');
      showError(data.error || 'Discord Login nicht verfügbar');
      return null;
    } catch {
      setError('Server nicht erreichbar');
      showError('Server nicht erreichbar');
      return null;
    }
  }, [showError]);

  const logout = useCallback(async () => {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
    setViewAsUser(null);
    setError(null);
  }, []);

  const updateUser = useCallback((updates: Partial<SafeUser>) => {
    setUser((prev) => (prev ? { ...prev, ...updates } : prev));
  }, []);

  const checkApproved = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/me', { credentials: 'include' });
      if (!res.ok) return false;
      const data = await res.json();
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
        const data = await res.json();
        setUser(data.user);
        setError(null);
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
            const data = await devRes.json();
            setUser(data.user);
            setError(null);
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
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
