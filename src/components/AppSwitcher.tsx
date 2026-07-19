import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { SafeUser, VersionInfo } from '../../shared/types';

interface AppSwitcherProps {
  user: SafeUser;
  version: VersionInfo | null;
}

interface AppItem {
  to: string;
  label: string;
  icon: ReactNode;
  visible: (user: SafeUser, version: VersionInfo | null, isMain: boolean, isInitialAdmin: boolean) => boolean;
}

const apps: AppItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
    visible: (_user, _version, _isMain, isInitialAdmin) => !isInitialAdmin,
  },
  {
    to: '/diary',
    label: 'Tagebuch',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
    ),
    visible: (_user, _version, _isMain, isInitialAdmin) => !isInitialAdmin,
  },
  {
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
    visible: (_user, _version, _isMain, isInitialAdmin) => !isInitialAdmin,
  },
  {
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
    to: '/feature-request',
    label: 'Feature Request',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    visible: (_user, version, isMain) => isMain && !!version?.aiEnabled,
  },
  {
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
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isInitialAdmin = user.username === 'admin';
  const isMain = version?.branch === 'main';

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  const visibleApps = apps.filter((app) => app.visible(user, version, isMain, isInitialAdmin));
  const current = visibleApps.find((app) => app.to === location.pathname);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-[var(--text-h)]"
        title="Anwendungen wechseln"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
        </svg>
        <span className="hidden sm:inline">{current?.label ?? 'Apps'}</span>
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 w-52 rounded-lg border border-[var(--border)] bg-[var(--panel)] shadow-lg z-50 overflow-hidden">
          {visibleApps.map((app) => (
            <Link
              key={app.to}
              to={app.to}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                location.pathname === app.to
                  ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
                  : 'text-[var(--text-h)] hover:bg-slate-700/50'
              }`}
            >
              {app.icon}
              {app.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
