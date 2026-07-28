import { Link, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { SafeUser, VersionInfo } from '../../shared/types';

interface AppSwitcherProps {
  user: SafeUser;
  version: VersionInfo | null;
}

interface AppItem {
  id: string;
  to: string;
  label: string;
  icon: ReactNode;
  visible: (user: SafeUser, version: VersionInfo | null, isInitialAdmin: boolean) => boolean;
}

const apps: AppItem[] = [
  {
    id: 'dashboard',
    to: '/',
    label: 'Dashboard',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
    visible: (_user, _version, isInitialAdmin) => !isInitialAdmin,
  },
  {
    id: 'notes',
    to: '/tagebuch',
    label: 'Tagebuch',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
    ),
    visible: (_user, _version, isInitialAdmin) => !isInitialAdmin,
  },
  {
    id: 'bingo',
    to: '/bingo',
    label: 'Bingo',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
    visible: (_user, _version, isInitialAdmin) => !isInitialAdmin,
  },
  {
    id: 'world',
    to: '/welt',
    label: 'Welt',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
    visible: (_user, _version, isInitialAdmin) => !isInitialAdmin,
  },
  {
    id: 'recordings',
    to: '/recordings',
    label: 'Aufnahmen',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    ),
    visible: (user, version) => user.isAdmin && !!version?.recordingEnabled,
  },
  {
    id: 'admin',
    to: '/admin',
    label: 'Admin',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      </svg>
    ),
    visible: (user) => user.isAdmin,
  },
];

export function AppSwitcher({ user, version }: AppSwitcherProps) {
  const location = useLocation();
  const isInitialAdmin = user.username === 'admin';

  const visibleApps = apps.filter(
    (app) => !user.disabledApps.includes(app.id) && app.visible(user, version, isInitialAdmin),
  );

  return (
    <nav className="flex items-center gap-1">
      {visibleApps.map((app) => {
        const active = location.pathname === app.to;
        return (
          <Link
            key={app.id}
            to={app.to}
            title={app.label}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              active
                ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
                : 'text-slate-300 hover:bg-slate-700/50 hover:text-[var(--text-h)]'
            }`}
          >
            {app.icon}
            <span className="hidden md:inline">{app.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
