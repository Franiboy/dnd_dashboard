import { useState } from 'react';

interface LoginProps {
  onLogin: (password: string) => void;
  error: string | null;
}

export function Login({ onLogin, error }: LoginProps) {
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setLocalError('Passwort eingeben');
      return;
    }
    setLocalError(null);
    onLogin(password);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-8 shadow-xl"
      >
        <h1 className="text-3xl font-bold text-[var(--text-h)] mb-2 text-center">DnD Dashboard</h1>
        <p className="text-center mb-6 text-slate-400">Passwort eingeben, um fortzufahren</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Passwort"
          className="w-full px-4 py-3 rounded-lg bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] mb-4"
        />
        {(error || localError) && (
          <p className="text-[var(--danger)] text-sm mb-4">{error || localError}</p>
        )}
        <button
          type="submit"
          className="w-full py-3 rounded-lg bg-[var(--accent)] text-slate-900 font-semibold hover:bg-green-400 transition"
        >
          Einloggen
        </button>
      </form>
    </div>
  );
}
