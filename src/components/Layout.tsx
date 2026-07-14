import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { SafeUser } from '../../shared/types';

interface LayoutProps {
  user: SafeUser;
  onLogout: () => void;
  children: ReactNode;
}

export function Layout({ user, onLogout, children }: LayoutProps) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-3 border-b border-[var(--border)] bg-[var(--panel)]">
        <div className="flex items-center gap-3 font-semibold text-[var(--text-h)]">
          {user.avatarUrl && <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-full" />}
          <span>{user.displayName}</span>
        </div>
        <div className="flex gap-4">
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
