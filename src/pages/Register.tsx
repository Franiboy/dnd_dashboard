import { useState } from 'react';

interface RegisterProps {
  onRegister: (username: string, displayName: string, password: string) => Promise<string | null>;
  onBack: () => void;
  error: string | null;
}

export function Register({ onRegister, onBack, error }: RegisterProps) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (!username.trim() || !displayName.trim() || !password.trim()) return;
    const msg = await onRegister(username.trim(), displayName.trim(), password);
    if (msg) setMessage(msg);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-8 shadow-xl"
      >
        <h1 className="text-3xl font-bold text-[var(--text-h)] mb-2 text-center">Registrieren</h1>
        <p className="text-center mb-6 text-slate-400">Neuen Account anlegen</p>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          className="w-full px-4 py-3 rounded-lg bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] mb-4"
        />
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Anzeigename"
          className="w-full px-4 py-3 rounded-lg bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] mb-4"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Passwort"
          className="w-full px-4 py-3 rounded-lg bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] mb-4"
        />
        {error && <p className="text-[var(--danger)] text-sm mb-4">{error}</p>}
        {message && <p className="text-[var(--accent)] text-sm mb-4">{message}</p>}
        <button
          type="submit"
          className="w-full py-3 rounded-lg bg-[var(--accent)] text-slate-900 font-semibold hover:bg-green-400 transition"
        >
          Registrieren
        </button>
        <button
          type="button"
          onClick={onBack}
          className="w-full mt-3 py-3 rounded-lg border border-[var(--border)] text-[var(--text-h)] hover:bg-slate-800 transition"
        >
          Zurück zum Login
        </button>
      </form>
    </div>
  );
}
