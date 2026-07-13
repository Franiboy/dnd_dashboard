import { useState } from 'react';
import { PasswordInput } from '../components/PasswordInput';

interface LoginProps {
  onLogin: (username: string, password: string) => void;
  onRegister: () => void;
  error: string | null;
}

export function Login({ onLogin, onRegister, error }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim() && password.trim()) onLogin(username.trim(), password);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-8 shadow-xl"
      >
        <h1 className="text-3xl font-bold text-[var(--text-h)] mb-2 text-center">DnD Dashboard</h1>
        <p className="text-center mb-6 text-slate-400">Melde dich an</p>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          className="w-full px-4 py-3 rounded-lg bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] mb-4"
        />
        <PasswordInput
          value={password}
          onChange={setPassword}
          placeholder="Passwort"
          className="mb-4"
        />
        {error && <p className="text-[var(--danger)] text-sm mb-4">{error}</p>}
        <button
          type="submit"
          className="w-full py-3 rounded-lg bg-[var(--accent)] text-slate-900 font-semibold hover:bg-green-400 transition"
        >
          Einloggen
        </button>
        <button
          type="button"
          onClick={onRegister}
          className="w-full mt-3 py-3 rounded-lg border border-[var(--border)] text-[var(--text-h)] hover:bg-slate-800 transition"
        >
          Registrieren
        </button>
      </form>
    </div>
  );
}
