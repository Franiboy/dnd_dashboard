import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { SafeUser } from '../../shared/types';

interface ProfileProps {
  user: SafeUser;
  onUpdateDisplayName: (displayName: string) => Promise<boolean>;
}

export function Profile({ user, onUpdateDisplayName }: ProfileProps) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(user.displayName);
  }, [user.displayName]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setError(null);
    if (!displayName.trim()) {
      setError('Anzeigename darf nicht leer sein');
      return;
    }
    const ok = await onUpdateDisplayName(displayName.trim());
    if (ok) {
      setMessage('Anzeigename gespeichert');
    }
  };

  return (
    <div className="min-h-screen p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-[var(--text-h)]">Profil</h1>
        <Link to="/" className="text-slate-400 hover:text-[var(--text-h)]">← Zurück</Link>
      </div>

      <div className="max-w-md mx-auto bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-8 shadow-xl">
        <div className="mb-6">
          <label className="block text-slate-400 text-sm mb-2">Username</label>
          <div className="text-[var(--text-h)] font-medium">{user.username}</div>
        </div>

        <form onSubmit={submit}>
          <label className="block text-slate-400 text-sm mb-2">Anzeigename</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] mb-4"
          />
          {error && <p className="text-[var(--danger)] text-sm mb-4">{error}</p>}
          {message && <p className="text-[var(--accent)] text-sm mb-4">{message}</p>}
          <button
            type="submit"
            className="w-full py-3 rounded-lg bg-[var(--accent)] text-slate-900 font-semibold hover:bg-green-400 transition"
          >
            Speichern
          </button>
        </form>
      </div>
    </div>
  );
}
