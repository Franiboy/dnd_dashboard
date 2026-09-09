import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { AppSwitcher } from './AppSwitcher';
import { GlobalSearch } from './GlobalSearch';
import { HeaderAction } from './HeaderAction';
import { StoryArcFilter } from './StoryArcFilter';
import { useAuth } from '../hooks/useAuth';
import type { SafeUser, VersionInfo } from '../../shared/types';

// Routes the global story-arc filter applies to; shown in the header there.
const STORY_ARC_FILTER_PATHS = ['/sessions', '/tagebuch', '/welt'];

interface LayoutProps {
  user: SafeUser;
  realUser?: SafeUser | null;
  version: VersionInfo | null | undefined;
  onLogout: () => void;
  children: ReactNode;
}

export function Layout({ user, realUser, version, onLogout, children }: LayoutProps) {
  const isSimulating = realUser !== undefined && realUser !== null && realUser.id !== user.id;
  const { clearViewAsUser } = useAuth();
  const location = useLocation();
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const update = () => {
      const rect = header.getBoundingClientRect();
      document.documentElement.style.setProperty('--header-height', `${rect.height}px`);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

  const logoutIcon = (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header
        ref={headerRef}
        className="relative z-10 flex flex-col border-b border-[var(--border)] bg-[var(--panel)]"
      >
        <div className="flex items-center gap-2 px-3 sm:px-6 py-2">
          {/* Left: user (Discord avatar + name) */}
          <div className="flex min-w-0 items-center gap-2 bg-slate-800/60 border border-[var(--border)] rounded-full pl-2 pr-4 py-1">
            {user.avatarUrl && (
              <img src={user.avatarUrl} alt="" className="w-6 h-6 rounded-full shrink-0" />
            )}
            <span className="hidden md:inline truncate text-sm font-medium text-[var(--text-h)]">
              {user.displayName}
            </span>
          </div>

          {/* Center: app switcher, scrollable on narrow screens */}
          <div className="flex min-w-0 flex-1 justify-center">
            <div className="flex min-w-0 max-w-full overflow-x-auto">
              <AppSwitcher user={user} version={version} />
            </div>
          </div>

          {/* Right: global search + story-arc filter (on affected routes) + logout */}
          <div className="flex shrink-0 items-center gap-2">
            <GlobalSearch user={user} version={version} />
            {STORY_ARC_FILTER_PATHS.includes(location.pathname) && <StoryArcFilter />}
            <HeaderAction onClick={onLogout} icon={logoutIcon} variant="danger">
              Logout
            </HeaderAction>
          </div>
        </div>
        {isSimulating && (
          <div className="bg-[var(--warning)]/20 border-t border-[var(--warning)]/40 px-6 py-2 flex items-center justify-between">
            <span className="text-sm text-[var(--text-h)]">
              Du simulierst die Ansicht von <strong>{user.displayName}</strong>.
            </span>
            <button
              type="button"
              onClick={clearViewAsUser}
              className="text-sm font-semibold text-[var(--warning)] hover:underline"
            >
              Zurück zu {realUser?.displayName}
            </button>
          </div>
        )}
      </header>
      <main className="flex-1 min-h-0 overflow-auto">{children}</main>
    </div>
  );
}
