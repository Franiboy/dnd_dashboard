import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loading } from '../components/Loading';

interface LoginProps {
  onDiscordLogin: () => Promise<string | null>;
  error: string | null;
}

export function Login({ onDiscordLogin, error }: LoginProps) {
  const [localError, setLocalError] = useState<string | null>(null);
  const [clickCount, setClickCount] = useState(0);
  const [showAdmin, setShowAdmin] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleDiscord = async () => {
    setLocalError(null);
    setLoading(true);
    const url = await onDiscordLogin();
    if (url) {
      window.location.href = url;
    } else {
      setLoading(false);
    }
  };

  const handleLogoClick = () => {
    const next = clickCount + 1;
    setClickCount(next);
    if (next >= 5) {
      setShowAdmin(true);
      setClickCount(0);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-8 shadow-xl text-center">
        <h1
          className="text-3xl font-bold text-[var(--text-h)] mb-2 cursor-default select-none"
          onClick={handleLogoClick}
        >
          DnD Dashboard
        </h1>
        <p className="mb-6 text-slate-400">Melde dich mit Discord an</p>

        <button
          onClick={handleDiscord}
          disabled={loading}
          className="w-full py-3 rounded-lg bg-[#5865F2] text-white font-semibold hover:bg-[#4752C4] transition mb-3 disabled:opacity-50"
        >
          {loading ? (
            <Loading text="Weiterleitung..." size="sm" className="justify-center text-white" />
          ) : (
            'Mit Discord anmelden'
          )}
        </button>

        {showAdmin && (
          <Link
            to="/admin-login"
            className="inline-block text-sm text-slate-500 hover:text-[var(--text-h)] underline"
          >
            Admin Login
          </Link>
        )}

        {(error || localError) && (
          <p className="text-[var(--danger)] text-sm mt-4">{error || localError}</p>
        )}
      </div>
    </div>
  );
}
