import { Link } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import type { SafeUser } from '../../shared/types';

interface LayoutProps {
  user: SafeUser;
  onLogout: () => void;
  children: ReactNode;
}

export function Layout({ user, onLogout, children }: LayoutProps) {
  const [version, setVersion] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/version')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.version === 'number') {
          setVersion(data.version);
        }
      })
      .catch(() => {
        // Version is optional; failing silently is fine
      });
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="grid grid-cols-3 items-center px-6 py-3 border-b border-[var(--border)] bg-[var(--panel)]">
        <div className="flex items-center gap-3 font-semibold text-[var(--text-h)]">
          {user.avatarUrl && <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-full" />}
          <span>{user.displayName}</span>
        </div>

        <div className="flex justify-center">
          {version !== null && (
            <span className="text-2xl font-black font-mono text-[var(--text-h)] drop-shadow-[0_4px_8px_rgba(0,0,0,0.5)] transition-transform duration-200 hover:scale-110">
              v.{version}
            </span>
          )}
        </div>

        <div className="flex justify-end gap-4">
          {user.isAdmin && (
            <Link to="/admin" className="text-slate-400 hover:text-[var(--text-h)]">
              Admin
            </Link>
          )}
          <button onClick={onLogout} className="text-slate-400 hover:text-[var(--text-h)]">
            Logout
          </button>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
