import { useEffect, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { useError } from '../hooks/useError';
import { BackButton } from '../components/BackButton';
import { Loading } from '../components/Loading';
import { LogPanel } from '../components/LogPanel';
import { Modal } from '../components/Modal';
import { APPS } from '../lib/apps';
import type { SafeUser } from '../../shared/types';

interface AdminProps {
  currentUser: SafeUser;
}

export function Admin({ currentUser }: AdminProps) {
  const { request } = useApi();
  const { showError } = useError();
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<{ id: string; endpoint: string } | null>(null);
  const [managingAppsFor, setManagingAppsFor] = useState<SafeUser | null>(null);

  const isActionLoading = (id: string, endpoint: string) =>
    actionLoading?.id === id && actionLoading?.endpoint === endpoint;

  useEffect(() => {
    const source = new EventSource('/api/admin/users/events', { withCredentials: true });
    source.addEventListener('users', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (Array.isArray(data)) {
          setUsers(data);
          setLoading(false);
          setError(null);
        }
      } catch {
        // ignore parse errors
      }
    });
    source.addEventListener('error', () => {
      // Connection errors are handled silently; the browser reconnects automatically
    });
    return () => source.close();
  }, []);

  useEffect(() => {
    if (error) showError(error);
  }, [error, showError]);

  const action = async (id: string, endpoint: string, body?: object) => {
    setActionLoading({ id, endpoint });
    const { error: actionError } = await request(`/api/admin/users/${id}${endpoint}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
    });
    setActionLoading(null);
    if (actionError) setError(actionError);
  };

  const deleteU = async (id: string) => {
    if (!confirm('Wirklich löschen?')) return;
    setActionLoading({ id, endpoint: '/delete' });
    const { error: deleteError } = await request(`/api/admin/users/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    setActionLoading(null);
    if (deleteError) setError(deleteError);
  };

  const isOwn = (u: SafeUser) => u.id === currentUser.id;
  const isInitialAdmin = (u: SafeUser) => u.username === 'admin';

  function AppAccessModal({ user, onClose }: { user: SafeUser; onClose: () => void }) {
    const disableableApps = APPS.filter((app) => app.disableable && (!app.adminOnly || user.isAdmin));
    const [disabled, setDisabled] = useState<string[]>(user.disabledApps);
    const toggle = (id: string) =>
      setDisabled((prev) => (prev.includes(id) ? prev.filter((app) => app !== id) : [...prev, id]));
    const enableAll = () => setDisabled([]);
    const disableAll = () => setDisabled(disableableApps.map((app) => app.id));

    async function handleSave() {
      await action(user.id, '/disabled-apps', { disabledApps: disabled });
      onClose();
    }

    const enabledCount = disableableApps.length - disabled.length;

    function getAppIcon(id: string) {
      switch (id) {
        case 'notes':
          return (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
          );
        case 'bingo':
          return (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
          );
        case 'world':
          return (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          );
        case 'recordings':
          return (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          );
        default:
          return (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18" />
            </svg>
          );
      }
    }

    return (
      <Modal
        isOpen
        title={`Apps für ${user.displayName}`}
        onClose={onClose}
        contentClassName="max-h-[65vh] overflow-y-auto"
        actions={
          <>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded border border-[var(--border)] text-[var(--text-h)] hover:bg-slate-800 transition"
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isActionLoading(user.id, '/disabled-apps')}
              className="px-4 py-2 rounded font-semibold bg-[var(--accent)] text-slate-900 hover:brightness-110 transition disabled:opacity-50"
            >
              Speichern
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">
              {enabledCount} von {disableableApps.length} Apps aktiv
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={enableAll}
                className="px-2 py-1 rounded text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/10 transition"
              >
                Alle aktivieren
              </button>
              <button
                type="button"
                onClick={disableAll}
                className="px-2 py-1 rounded text-xs font-medium text-red-400 hover:bg-red-500/10 transition"
              >
                Alle deaktivieren
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {disableableApps.map((app) => {
              const isDisabled = disabled.includes(app.id);
              return (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => toggle(app.id)}
                  className={`group relative flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                    isDisabled
                      ? 'border-red-500/30 bg-red-500/5 hover:bg-red-500/10'
                      : 'border-[var(--accent)]/30 bg-[var(--accent)]/5 hover:bg-[var(--accent)]/10'
                  }`}
                >
                  <span
                    className={`shrink-0 mt-0.5 transition-colors ${
                      isDisabled ? 'text-slate-500' : 'text-[var(--accent)]'
                    }`}
                  >
                    {getAppIcon(app.id)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[var(--text-h)]">{app.label}</span>
                      <span
                        className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                          isDisabled
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-[var(--accent)]/20 text-[var(--accent)]'
                        }`}
                      >
                        {isDisabled ? 'Deaktiviert' : 'Aktiv'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      {isDisabled
                        ? 'Klicke, um den Zugriff auf diese App freizugeben.'
                        : 'Klicke, um den Zugriff auf diese App zu sperren.'}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <div className="min-h-full p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-[var(--text-h)]">Administration</h1>
        <BackButton />
      </div>

      {currentUser.isAdmin && (
        <>
          <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5 overflow-auto">
            {loading ? (
              <Loading text="Verbinde..." />
            ) : users.length === 0 ? (
              <p className="text-slate-400">Keine Benutzer vorhanden.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="p-3">Anzeigename</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Admin</th>
                    <th className="p-3">Aktionen</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="p-3 text-[var(--text-h)]">
                        <div className="flex items-center gap-2">
                          {u.avatarUrl && <img src={u.avatarUrl} alt="" className="w-8 h-8 rounded-full" />}
                          <span>{u.displayName} {isInitialAdmin(u) && <span className="text-xs text-slate-500">(Ursprungsadmin)</span>}
                          {isOwn(u) && !isInitialAdmin(u) && <span className="text-xs text-slate-500"> (Du)</span>}</span>
                        </div>
                      </td>
                      <td className="p-3">
                        {u.isApproved ? (
                          <span className="text-[var(--accent)]">Freigegeben</span>
                        ) : (
                          <span className="text-[var(--danger)]">Wartend</span>
                        )}
                      </td>
                      <td className="p-3">{u.isAdmin ? 'Ja' : 'Nein'}</td>
                      <td className="p-3 flex flex-wrap gap-2">
                        {!isInitialAdmin(u) && !isOwn(u) && (
                          <>
                            {!u.isApproved && (
                              <button
                                onClick={() => action(u.id, '/approve')}
                                disabled={isActionLoading(u.id, '/approve')}
                                className="px-3 py-1 rounded bg-[var(--accent)] text-slate-900 text-xs font-semibold disabled:opacity-50"
                              >
                                {isActionLoading(u.id, '/approve') ? (
                                  <Loading text="" size="sm" />
                                ) : (
                                  'Freigeben'
                                )}
                              </button>
                            )}
                            {u.isApproved && (
                              <button
                                onClick={() => action(u.id, '/reject')}
                                disabled={isActionLoading(u.id, '/reject')}
                                className="px-3 py-1 rounded bg-[var(--warning)] text-slate-900 text-xs font-semibold disabled:opacity-50"
                              >
                                {isActionLoading(u.id, '/reject') ? (
                                  <Loading text="" size="sm" />
                                ) : (
                                  'Sperren'
                                )}
                              </button>
                            )}
                            <button
                              onClick={() => action(u.id, '/admin', { isAdmin: !u.isAdmin })}
                              disabled={isActionLoading(u.id, '/admin')}
                              className="px-3 py-1 rounded bg-slate-700 text-[var(--text-h)] text-xs disabled:opacity-50"
                            >
                              {isActionLoading(u.id, '/admin') ? (
                                <Loading text="" size="sm" />
                              ) : (
                                u.isAdmin ? 'Admin entfernen' : 'Zum Admin'
                              )}
                            </button>
                            <button
                              onClick={() => setManagingAppsFor(u)}
                              disabled={isActionLoading(u.id, '/disabled-apps')}
                              className="px-3 py-1 rounded bg-slate-700 text-[var(--text-h)] text-xs disabled:opacity-50"
                            >
                              {isActionLoading(u.id, '/disabled-apps') ? (
                                <Loading text="" size="sm" />
                              ) : (
                                'Apps'
                              )}
                            </button>
                            <button
                              onClick={() => deleteU(u.id)}
                              disabled={isActionLoading(u.id, '/delete')}
                              className="px-3 py-1 rounded bg-[var(--danger)] text-white text-xs disabled:opacity-50"
                            >
                              {isActionLoading(u.id, '/delete') ? (
                                <Loading text="" size="sm" />
                              ) : (
                                'Löschen'
                              )}
                            </button>
                          </>
                        )}
                        {(isInitialAdmin(u) || isOwn(u)) && (
                          <span className="text-slate-500 text-xs">Geschützt</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="mt-6">
            <LogPanel />
          </div>
        </>
      )}

      {managingAppsFor && <AppAccessModal user={managingAppsFor} onClose={() => setManagingAppsFor(null)} />}
    </div>
  );
}
