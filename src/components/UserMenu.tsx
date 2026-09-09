import { useEffect, useRef, useState } from 'react';
import type { SafeUser, UserRole } from '../../shared/types';
import { Avatar } from './Avatar';

interface UserMenuProps {
  user: SafeUser;
  onLogout: () => void;
  /** Present while an admin simulates another user; renders the exit action. */
  onExitSimulation?: () => void;
}

const ROLE_LABELS: Record<UserRole, string> = {
  guest: 'Gast',
  dungeon_master: 'Dungeon Master',
  player: 'Spieler',
};

export function UserMenu({ user, onLogout, onExitSimulation }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const close = () => setOpen(false);
  const roleLabel = [user.isAdmin ? 'Admin' : null, ROLE_LABELS[user.role]]
    .filter(Boolean)
    .join(' · ');

  const menuItemClass =
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]';

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Benutzermenü"
        onClick={() => setOpen((o) => !o)}
        className="group block rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <Avatar
          src={user.avatarUrl}
          name={user.displayName}
          className="w-9 h-9 ring-2 ring-slate-600 transition-shadow group-hover:ring-[var(--accent)]"
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Benutzermenü"
          className="absolute left-0 top-11 z-50 w-60 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-2 shadow-xl"
        >
          <div className="mb-1.5 flex items-center gap-2.5 border-b border-[var(--border)] px-1 pb-2.5 pt-1">
            <Avatar src={user.avatarUrl} name={user.displayName} className="w-9 h-9" />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-sm font-semibold text-[var(--text-h)]">
                {user.displayName}
              </span>
              <span className="text-[11px] text-slate-400">{roleLabel}</span>
            </span>
          </div>

          {onExitSimulation && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                onExitSimulation();
              }}
              className={`${menuItemClass} text-[var(--text)] hover:bg-slate-700/50`}
            >
              🔄 Ansicht simulieren beenden
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              onLogout();
            }}
            className={`${menuItemClass} text-[var(--danger)] hover:bg-[var(--danger)]/10`}
          >
            🚪 Logout
          </button>
        </div>
      )}
    </div>
  );
}
