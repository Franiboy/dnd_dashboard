import { type ReactNode } from 'react';
import { AppSwitcher } from './AppSwitcher';
import { HeaderAction } from './HeaderAction';
import type { SafeUser, VersionInfo } from '../../shared/types';

interface LayoutProps {
  user: SafeUser;
  version: VersionInfo | null | undefined;
  onLogout: () => void;
  children: ReactNode;
}

export function Layout({ user, version, onLogout, children }: LayoutProps) {
  const logoutIcon = (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="relative z-10 flex items-center justify-center px-6 py-3 border-b border-[var(--border)] bg-[var(--panel)]">
        <div className="absolute left-6 flex items-center gap-3 font-semibold text-[var(--text-h)]">
          {user.avatarUrl && <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-full" />}
          <span>{user.displayName}</span>
        </div>

        <AppSwitcher user={user} version={version} />

        <div className="absolute right-6">
          <HeaderAction onClick={onLogout} icon={logoutIcon} variant="danger">
            Logout
          </HeaderAction>
        </div>
      </header>
      <main className="flex-1 min-h-0 overflow-auto">{children}</main>
    </div>
  );
}
