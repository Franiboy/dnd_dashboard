import { Link, useLocation } from 'react-router-dom';
import type { SafeUser, VersionInfo } from '../../shared/types';
import { APPS, isAppVisible } from '../lib/apps';
import { AppIcon } from './AppIcon';

interface AppSwitcherProps {
  user: SafeUser;
  version: VersionInfo | null | undefined;
}

export function AppSwitcher({ user, version }: AppSwitcherProps) {
  const location = useLocation();

  const visibleApps = APPS.filter(
    (app) => app.id !== 'dashboard' && isAppVisible(app, user, version)
  );

  return (
    <nav className="flex items-center gap-1">
      {visibleApps.map((app) => {
        const active = location.pathname === app.path;
        return (
          <Link
            key={app.id}
            to={app.path}
            title={app.label}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              active
                ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
                : 'text-slate-300 hover:bg-slate-700/50 hover:text-[var(--text-h)]'
            }`}
          >
            <AppIcon id={app.iconId ?? app.id} size={16} />
            <span className="hidden md:inline">{app.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
