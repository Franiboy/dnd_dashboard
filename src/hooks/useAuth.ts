import { useCallback, useEffect, useState } from 'react';
import { useError } from './useError';
import type { SafeUser } from '../../shared/types';

export function useAuth() {
  const { showError } = useError();
  const [user, setUser] = useState<SafeUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loginAdmin = async (username: string, password: string): Promise<boolean> => {
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
  };

  const handleDiscordCallback = async (code: string, state: string): Promise<{ ok: boolean; pending?: boolean; message?: string }> => {
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
        return { ok: false, pending: true, message: data.error || 'Account wurde noch nicht freigegeben' };
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
  };

  const startDiscordLogin = async (): Promise<string | null> => {
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
  };

  const logout = async () => {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
    setError(null);
  };

  const updateUser = (updates: Partial<SafeUser>) => {
    setUser((prev) => (prev ? { ...prev, ...updates } : prev));
  };

  const checkApproved = async (): Promise<boolean> => {
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
  };

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch('/api/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setError(null);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    }
    setLoading(false);
  }, [setUser, setLoading, setError]);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  return { user, loading, error, loginAdmin, handleDiscordCallback, startDiscordLogin, logout, checkApproved, updateUser, setError };
}
