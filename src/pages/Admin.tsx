import { useEffect, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { useError } from '../hooks/useError';
import { BackButton } from '../components/BackButton';
import { Loading } from '../components/Loading';
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

  const disableableApps = APPS.filter((app) => app.disableable);

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
    const [disabled, setDisabled] = useState<string[]>(user.disabledApps);
    const toggle = (id: string) =>
      setDisabled((prev) => (prev.includes(id) ? prev.filter((app) => app !== id) : [...prev, id]));

    async function handleSave() {
      await action(user.id, '/disabled-apps', { disabledApps: disabled });
      onClose();
    }

    return (
      <Modal
        isOpen
        title={`Apps für ${user.displayName}`}
        onClose={onClose}
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
        <div className="space-y-2">
          {disableableApps.map((app) => (
            <label key={app.id} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={disabled.includes(app.id)}
                onChange={() => toggle(app.id)}
                className="rounded border-[var(--border)] bg-slate-900 text-[var(--accent)] focus:ring-[var(--accent)]"
              />
              <span className="text-[var(--text-h)]">{app.label} deaktivieren</span>
            </label>
          ))}
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
              <th className="p-3">Preview</th>
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
                <td className="p-3">{u.isAdmin || u.canAccessPreviews ? 'Ja' : 'Nein'}</td>
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
                      {!u.isAdmin && (
                        <button
                          onClick={() => action(u.id, '/preview-access', { canAccessPreviews: !u.canAccessPreviews })}
                          disabled={isActionLoading(u.id, '/preview-access')}
                          className="px-3 py-1 rounded bg-slate-700 text-[var(--text-h)] text-xs disabled:opacity-50"
                        >
                          {isActionLoading(u.id, '/preview-access') ? (
                            <Loading text="" size="sm" />
                          ) : (
                            u.canAccessPreviews ? 'Preview sperren' : 'Preview erlauben'
                          )}
                        </button>
                      )}
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
      )}

      {managingAppsFor && <AppAccessModal user={managingAppsFor} onClose={() => setManagingAppsFor(null)} />}
    </div>
  );
}
