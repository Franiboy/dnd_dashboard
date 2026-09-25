import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { SafeUser, VersionInfo } from '../../shared/types';
import { APPS, getAppLabel, isAppVisible } from '../lib/apps';
import { useI18n } from '../hooks/useI18n';
import { AppIcon } from './AppIcon';

interface AppSwitcherProps {
  user: SafeUser;
  version: VersionInfo | null | undefined;
}

export function AppSwitcher({ user, version }: AppSwitcherProps) {
  const location = useLocation();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // True while the icon rail fits the space the header row leaves for this
  // slot; when it does not, the popup button takes over. There is never a
  // scrollbar on the rail.
  const [railFits, setRailFits] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const railInnerRef = useRef<HTMLDivElement>(null);

  const visibleApps = APPS.filter(
    (app) => app.id !== 'dashboard' && isAppVisible(app, user, version)
  );

  // Fit check, deliberately measured instead of breakpoint-based: apps become
  // visible or invisible with permissions and feature flags, so a fixed pixel
  // switch would either scroll or waste space. The root is flex-1 with basis
  // 0, so its width is purely the slot size and does not depend on which
  // variant is currently shown — the check cannot feed back into itself. The
  // rail stays mounted and only turns invisible while collapsed, keeping its
  // natural width measurable through the w-max inner wrapper.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const inner = railInnerRef.current;
    if (!root || !inner) return;

    const update = () => {
      const fits = inner.getBoundingClientRect().width <= root.clientWidth + 1;
      setRailFits(fits);
      // If the rail comes back while the popup is open (resize, an app
      // disappears), the trigger disappears with it — close the menu so it
      // does not float orphaned in the header.
      if (fits) setOpen(false);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

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
    <div ref={rootRef} className="flex min-w-0 flex-1 items-center">
      {/* The icon rail. Labels only from xl on: with seven apps the labeled
          rail would collapse to the popup in many spots where the icons
          themselves still fit comfortably. */}
      <nav
        aria-label={t('shell.apps.navigation')}
        className={`flex min-w-0 flex-1 items-center gap-1 overflow-x-hidden ${railFits ? '' : 'invisible'}`}
      >
        <div ref={railInnerRef} className="mx-auto flex w-max shrink-0 items-center gap-1">
          {visibleApps.map((app) => {
            const active = location.pathname === app.path;
            const label = getAppLabel(app, t);
            return (
              <Link
                key={app.id}
                to={app.path}
                title={label}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
                    : 'text-slate-300 hover:bg-slate-700/50 hover:text-[var(--text-h)]'
                }`}
              >
                <AppIcon id={app.iconId ?? app.id} size={16} />
                <span className="hidden xl:inline">{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Collapsed variant: takes over whenever the rail does not fit. The
          trigger keeps its 44px touch size; the menu stays anchored to the
          header, so this wrapper must not create a positioning context. */}
      <div className={`flex items-center ${railFits && visibleApps.length > 0 ? 'hidden' : ''}`}>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('shell.apps.picker')}
          onClick={() => setOpen((o) => !o)}
          className={`flex size-11 items-center justify-center rounded-lg transition-colors ${
            open
              ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
              : 'text-slate-300 hover:bg-slate-700/50 hover:text-[var(--text-h)]'
          }`}
        >
          <svg
            aria-hidden="true"
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
      </div>

      {open && (
        <div
          role="menu"
          aria-label={t('shell.apps.picker')}
          className="menu-pop-in absolute inset-x-3 top-full z-50 mx-auto mt-2 max-h-[calc(100dvh-var(--header-height,0px)-1rem)] max-w-60 overflow-y-auto overscroll-contain rounded-xl border border-[var(--border)] bg-[var(--panel)] p-2 shadow-xl"
        >
          {visibleApps.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-400">{t('shell.apps.empty')}</p>
          ) : (
            visibleApps.map((app) => {
              const active = location.pathname === app.path;
              const label = getAppLabel(app, t);
              return (
                <Link
                  key={app.id}
                  to={app.path}
                  role="menuitem"
                  aria-label={label}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                  className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
                      : 'text-slate-300 hover:bg-slate-700/50 hover:text-[var(--text-h)]'
                  }`}
                >
                  <AppIcon id={app.iconId ?? app.id} size={16} />
                  {label}
                </Link>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
