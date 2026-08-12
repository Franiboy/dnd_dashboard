import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { AppSwitcher } from './AppSwitcher';
import { HeaderAction } from './HeaderAction';
import { Loading } from './Loading';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import type { SafeUser, VersionInfo } from '../../shared/types';

interface LayoutProps {
  user: SafeUser;
  realUser?: SafeUser | null;
  version: VersionInfo | null | undefined;
  onLogout: () => void;
  onUserChange: (updates: Partial<SafeUser>) => void;
  children: ReactNode;
}

export function Layout({ user, realUser, version, onLogout, onUserChange, children }: LayoutProps) {
  const isSimulating = realUser !== undefined && realUser !== null && realUser.id !== user.id;
  const { request } = useApi();
  const { clearViewAsUser } = useAuth();
  const location = useLocation();
  const headerRef = useRef<HTMLElement>(null);
  const [persons, setPersons] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    request<{ persons: string[] }>('/api/entities', undefined, false).then(({ data }) => {
      if (data) setPersons(data.persons ?? []);
    });
  }, [request]);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const update = () => {
      const rect = header.getBoundingClientRect();
      document.documentElement.style.setProperty('--header-height', `${rect.height}px`);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

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
      disabled={disabled || saving || isSimulating}
      title={isSimulating ? 'Personenauswahl ist im Simulationsmodus deaktiviert' : undefined}
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
      <header ref={headerRef} className="relative z-10 flex flex-col border-b border-[var(--border)] bg-[var(--panel)]">
        <div className="flex items-center gap-2 px-3 sm:px-6 py-2">
          {/* Left: user + active character */}
        <div className="flex min-w-0 items-center gap-2 bg-slate-800/60 border border-[var(--border)] rounded-full pl-2 pr-1 py-1">
          {user.avatarUrl && <img src={user.avatarUrl} alt="" className="w-6 h-6 rounded-full shrink-0" />}
          <span className="hidden md:inline truncate text-sm font-medium text-[var(--text-h)]">
            {user.displayName}
          </span>
          <div className="relative flex items-center">
            <select
              value={user.activePerson ?? ''}
              onChange={(e) => handleSelectPerson(e.target.value)}
              disabled={saving || isSimulating}
              title={isSimulating ? 'Personenauswahl ist im Simulationsmodus deaktiviert' : 'Aktive Person / Charakter wählen'}
              className="appearance-none bg-slate-900/60 border border-[var(--border)] hover:border-slate-600 rounded-lg pl-2 pr-6 py-1 text-xs font-medium text-slate-300 focus:outline-none focus:border-[var(--accent)] disabled:opacity-50 max-w-[10rem] min-w-0 cursor-pointer transition-colors"
            >
              <option value="">Person wählen</option>
              {persons.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </div>

        {/* Center: app switcher, scrollable on narrow screens */}
        <div className="flex min-w-0 flex-1 justify-center">
          <div className="flex min-w-0 max-w-full overflow-x-auto">
            <AppSwitcher user={user} version={version} />
          </div>
        </div>

        {/* Right: logout */}
        <div className="flex shrink-0 items-center">
          <HeaderAction onClick={onLogout} icon={logoutIcon} variant="danger">
            Logout
          </HeaderAction>
        </div>
      </div>
      {isSimulating && (
        <div className="bg-[var(--warning)]/20 border-t border-[var(--warning)]/40 px-6 py-2 flex items-center justify-between">
          <span className="text-sm text-[var(--text-h)]">
            Du simulierst die Ansicht von <strong>{user.displayName}</strong>.
          </span>
          <button
            type="button"
            onClick={clearViewAsUser}
            className="text-sm font-semibold text-[var(--warning)] hover:underline"
          >
            Zurück zu {realUser?.displayName}
          </button>
        </div>
      )}
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
