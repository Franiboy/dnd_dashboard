import { useEffect, useRef, useState } from 'react';
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
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const visibleApps = APPS.filter(
    (app) => app.id !== 'dashboard' && isAppVisible(app, user, version)
  );

  useEffect(() => {
    if (!open) return;

    const close = () => setOpen(false);

    // Ignore clicks inside the popup (including the trigger) so selecting an
    // app or toggling the button does not close the menu prematurely.
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <>
      {/* Phones: collapsed behind an app-picker button with a labeled popup,
          so no app icon has to be hunted down via horizontal scrolling. */}
      <div className="shrink-0 sm:hidden" ref={rootRef}>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="App-Auswahl"
          onClick={() => setOpen((o) => !o)}
          className={`flex size-11 items-center justify-center rounded-lg transition-colors ${
            open
              ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
              : 'text-slate-300 hover:bg-slate-700/50 hover:text-[var(--text-h)]'
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </button>

        {open && (
          <div
            role="menu"
            aria-label="App-Auswahl"
            className="menu-pop-in absolute inset-x-3 top-full z-50 mx-auto mt-2 max-h-[calc(100dvh-var(--header-height,0px)-1rem)] max-w-60 overflow-y-auto overscroll-contain rounded-xl border border-[var(--border)] bg-[var(--panel)] p-2 shadow-xl"
          >
            {visibleApps.map((app) => {
              const active = location.pathname === app.path;
              return (
                <Link
                  key={app.id}
                  to={app.path}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
                      : 'text-slate-300 hover:bg-slate-700/50 hover:text-[var(--text-h)]'
                  }`}
                >
                  <AppIcon id={app.iconId ?? app.id} size={16} />
                  {app.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* sm and up: the regular icon rail (labels from xl on, where seven
          labeled apps still fit next to the search without wrapping). */}
      <nav className="hidden min-w-0 max-w-full items-center gap-1 overflow-x-auto sm:flex">
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
              {/* Labels only from xl on: with seven apps the labeled switcher
                  would push the search out of the header row below xl. */}
              <span className="hidden xl:inline">{app.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
