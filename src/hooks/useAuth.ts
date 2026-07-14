import { useCallback, useEffect, useState } from 'react';
import { useError } from './useError';
import type { SafeUser } from '../../shared/types';

export function useAuth() {
  const { showError } = useError();
  const [user, setUser] = useState<SafeUser | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('dnd_token'));
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
        setToken(data.token);
        localStorage.setItem('dnd_token', data.token);
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

  const handleDiscordCallback = async (code: string): Promise<{ ok: boolean; message?: string }> => {
    try {
      const res = await fetch('/api/auth/discord/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok) {
        setUser(data.user);
        setToken(data.token);
        localStorage.setItem('dnd_token', data.token);
        setError(null);
        return { ok: true };
      }
      if (res.status === 403 && data.user && data.token) {
        setUser(data.user);
        setToken(data.token);
        localStorage.setItem('dnd_token', data.token);
        return { ok: false, message: data.error || 'Account wurde noch nicht freigegeben' };
      }
      setError(data.error || 'Discord Login fehlgeschlagen');
      showError(data.error || 'Discord Login fehlgeschlagen');
      return { ok: false };
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
    setToken(null);
    localStorage.removeItem('dnd_token');
  };

  const checkApproved = async (): Promise<boolean> => {
    try {
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch('/api/me', { headers, credentials: 'include' });
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
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch('/api/me', { headers, credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setError(null);
      } else {
        setUser(null);
        localStorage.removeItem('dnd_token');
        setToken(null);
      }
    } catch {
      setUser(null);
    }
    setLoading(false);
  }, [token, setUser, setToken, setLoading, setError]);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  return { user, token, loading, error, loginAdmin, handleDiscordCallback, startDiscordLogin, logout, checkApproved, setError };
}
