import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { AppSwitcher } from './AppSwitcher';
import { HeaderAction } from './HeaderAction';
import { Loading } from './Loading';
import { useApi } from '../hooks/useApi';
import type { SafeUser, VersionInfo } from '../../shared/types';

interface LayoutProps {
  user: SafeUser;
  version: VersionInfo | null | undefined;
  onLogout: () => void;
  onUserChange: (updates: Partial<SafeUser>) => void;
  children: ReactNode;
}

export function Layout({ user, version, onLogout, onUserChange, children }: LayoutProps) {
  const { request } = useApi();
  const location = useLocation();
  const [persons, setPersons] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    request<{ persons: string[] }>('/api/entities', undefined, false).then(({ data }) => {
      if (data) setPersons(data.persons ?? []);
    });
  }, [request]);

  const forced = location.pathname === '/tagebuch' && !user.activePerson;

  async function handleSelectPerson(name: string) {
    if (!name) return;
    setSaving(true);
    const { data, error } = await request<{ user: SafeUser }>('/api/me/active-person', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    setSaving(false);
    if (data?.user) {
      onUserChange({ activePerson: data.user.activePerson });
    } else if (error) {
      // Error toast is already shown by useApi.
    }
  }

  const selectElement = (disabled: boolean, className: string) => (
    <select
      value={user.activePerson ?? ''}
      onChange={(e) => handleSelectPerson(e.target.value)}
      disabled={disabled || saving}
      className={className}
    >
      <option value="">Person wählen</option>
      {persons.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </select>
  );

  const logoutIcon = (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="relative z-10 flex items-center justify-center px-6 py-3 border-b border-[var(--border)] bg-[var(--panel)]">
        <div className="absolute left-6 flex items-center gap-3 font-semibold text-[var(--text-h)]">
          {user.avatarUrl && <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-full" />}
          <div className="flex flex-col gap-0.5">
            <span>{user.displayName}</span>
            {selectElement(
              false,
              'max-w-[10rem] bg-slate-800 border border-[var(--border)] rounded-lg px-2 py-1 text-xs text-[var(--text-h)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50',
            )}
          </div>
        </div>

        <AppSwitcher user={user} version={version} />

        <div className="absolute right-6">
          <HeaderAction onClick={onLogout} icon={logoutIcon} variant="danger">
            Logout
          </HeaderAction>
        </div>
      </header>
      <main className="flex-1 min-h-0 overflow-auto">{children}</main>

      {forced && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-semibold text-[var(--text-h)] mb-2">Person auswählen</h3>
            <p className="text-sm text-slate-400 mb-4">
              Bevor du das Tagebuch nutzen kannst, musst du eine Person auswählen, aus deren Sicht
              geschrieben wird.
            </p>
            {persons.length === 0 ? (
              <p className="text-sm text-slate-500">
                Es sind noch keine Personen vorhanden. Lege zuerst im Bereich „Welt“ Personen an.
              </p>
            ) : (
              <div className="space-y-3">
                {selectElement(
                  saving,
                  'w-full bg-slate-800 border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-h)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50',
                )}
                {saving && <Loading size="sm" text="Wird gespeichert..." />}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
