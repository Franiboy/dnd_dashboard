import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SafeUser } from '../../shared/types';

interface AdminProps {
  currentUser: SafeUser;
}

export function Admin({ currentUser }: AdminProps) {
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/admin/users', { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Fehler beim Laden');
        return;
      }
      const data = await res.json();
      setUsers(data);
    } catch {
      setError('Server nicht erreichbar');
    }
  };

  useEffect(() => {
    fetchUsers();
    const interval = setInterval(fetchUsers, 1000);
    return () => clearInterval(interval);
  }, []);

  const action = async (id: string, endpoint: string, body?: object) => {
    const res = await fetch(`/api/admin/users/${id}${endpoint}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || 'Fehler');
      return;
    }
    fetchUsers();
  };

  const deleteU = async (id: string) => {
    if (!confirm('Wirklich löschen?')) return;
    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || 'Fehler');
      return;
    }
    fetchUsers();
  };

  const isOwn = (u: SafeUser) => u.id === currentUser.id;
  const isInitialAdmin = (u: SafeUser) => u.username === 'admin';

  return (
    <div className="min-h-screen p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-[var(--text-h)]">Administration</h1>
        <Link to="/" className="text-slate-400 hover:text-[var(--text-h)]">← Zurück</Link>
      </div>

      {error && <p className="text-[var(--danger)] mb-4">{error}</p>}

      <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5 overflow-auto">
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
                          className="px-3 py-1 rounded bg-[var(--accent)] text-slate-900 text-xs font-semibold"
                        >
                          Freigeben
                        </button>
                      )}
                      {u.isApproved && (
                        <button
                          onClick={() => action(u.id, '/reject')}
                          className="px-3 py-1 rounded bg-[var(--warning)] text-slate-900 text-xs font-semibold"
                        >
                          Sperren
                        </button>
                      )}
                      <button
                        onClick={() => action(u.id, '/admin', { isAdmin: !u.isAdmin })}
                        className="px-3 py-1 rounded bg-slate-700 text-[var(--text-h)] text-xs"
                      >
                        {u.isAdmin ? 'Admin entfernen' : 'Zum Admin'}
                      </button>
                      <button
                        onClick={() => deleteU(u.id)}
                        className="px-3 py-1 rounded bg-[var(--danger)] text-white text-xs"
                      >
                        Löschen
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
      </div>
    </div>
  );
}
