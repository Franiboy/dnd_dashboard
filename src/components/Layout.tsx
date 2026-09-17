import { useEffect, useRef, type ReactNode } from 'react';
import { AppSwitcher } from './AppSwitcher';
import { GlobalSearch } from './GlobalSearch';
import { StoryArcFilter } from './StoryArcFilter';
import { UserMenu } from './UserMenu';
import { useAuth } from '../hooks/useAuth';
import type { SafeUser, VersionInfo } from '../../shared/types';

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
              Only on very narrow phones it moves to its own full-width row
              below, where one row would genuinely be too cramped; from 480px
              on it shares the single header row (the arc filter truncates and
              the app rail scrolls, so shrinking wins over wrapping). With a
              non-zero basis the line break would be decided on the section's
              max-content width (untruncated arc name, app rail) before
              shrinking could kick in, wrapping the header even though
              shrinking would fit. */}
          <div className="order-last flex min-w-0 flex-1 basis-full items-center justify-center gap-3 min-[480px]:order-none min-[480px]:basis-0">
            <StoryArcFilter />
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
