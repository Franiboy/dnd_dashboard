import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BackButton } from '../components/BackButton';
import { Loading } from '../components/Loading';
import { PasswordInput } from '../components/PasswordInput';

interface AdminLoginProps {
  onLogin: (username: string, password: string) => Promise<boolean>;
  error: string | null;
}

export function AdminLogin({ onLogin, error }: AdminLoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const ok = await onLogin(username.trim(), password);
    setLoading(false);
    if (ok) navigate('/');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-8 shadow-xl"
      >
        <h1 className="text-3xl font-bold text-[var(--text-h)] mb-2 text-center">Admin Login</h1>
        <p className="text-center mb-6 text-slate-400">Nur für den Default Admin</p>
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
          disabled={loading}
          className="w-full py-3 rounded-lg bg-[var(--accent)] text-slate-900 font-semibold hover:bg-green-400 transition disabled:opacity-50"
        >
          {loading ? (
            <Loading text="" size="sm" className="justify-center" />
          ) : (
            'Einloggen'
          )}
        </button>
        <BackButton className="w-full justify-center mt-3" />
      </form>
    </div>
  );
}
