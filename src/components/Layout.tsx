import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { AppSwitcher } from './AppSwitcher';
import { GlobalSearch } from './GlobalSearch';
import { StoryArcFilter } from './StoryArcFilter';
import { UserMenu } from './UserMenu';
import { useAuth } from '../hooks/useAuth';
import type { SafeUser, VersionInfo } from '../../shared/types';

// Routes the global story-arc filter applies to; shown in the header there.
const STORY_ARC_FILTER_PATHS = ['/sessions', '/tagebuch', '/welt', '/zeitleiste'];

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

  return (
    <div className="h-screen supports-[height:100dvh]:h-dvh flex flex-col overflow-hidden">
      <header
        ref={headerRef}
        className="relative z-50 flex shrink-0 flex-col border-b border-[var(--border)] bg-[var(--panel)]"
      >
        <div className="flex flex-wrap items-center gap-2 px-3 sm:px-6 py-2">
          {/* Left: user menu (Discord avatar, role, logout) */}
          <UserMenu
            user={user}
            onLogout={onLogout}
            onExitSimulation={isSimulating ? clearViewAsUser : undefined}
          />

          {/* Middle: chapter filter and the app switcher, centered as a group.
              On phones it moves to its own full-width row below so it is not
              squeezed between avatar and search. From sm on the basis must be
              0: with basis-auto the line break would be decided on the
              section's max-content width (untruncated arc name, app rail)
              before truncation/scroll shrinking could kick in, wrapping the
              header to a second row even though shrinking would fit. */}
          <div className="order-last flex min-w-0 flex-1 basis-full items-center justify-center gap-3 sm:order-none sm:basis-0">
            {STORY_ARC_FILTER_PATHS.includes(location.pathname) && <StoryArcFilter />}
            <AppSwitcher user={user} version={version} />
          </div>

          {/* Right: global search */}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <GlobalSearch user={user} version={version} />
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
