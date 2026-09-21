import { useEffect, useRef, useState } from 'react';

export interface ActionMenuItem {
  /** Stable id, used as the React key. */
  id: string;
  label: string;
  /** Renders the item in the danger color; use for destructive actions. */
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

interface ActionMenuProps {
  /** Accessible name for the trigger and the menu panel. */
  ariaLabel: string;
  items: ActionMenuItem[];
  /** Disables the trigger, e.g. while a request for the surrounding row is running. */
  disabled?: boolean;
}

/**
 * Kebab ("...") menu for row-level actions. Follows the UserMenu/AppSwitcher
 * dropdown pattern (outside click and Escape close it) and renders nothing
 * when there are no items, so callers can mount it unconditionally.
 */
export function ActionMenu({ ariaLabel, items, disabled = false }: ActionMenuProps) {
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

  if (items.length === 0) return null;

  const itemClass = (danger?: boolean) =>
    `flex min-h-11 w-full items-center rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
      danger
        ? 'text-[var(--danger)] hover:bg-[var(--danger)]/10'
        : 'text-slate-300 hover:bg-slate-700/50 hover:text-[var(--text-h)]'
    }`;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex size-8 items-center justify-center rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
          open
            ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
            : 'bg-slate-700 text-[var(--text-h)] hover:bg-slate-600'
        }`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="currentColor"
          stroke="none"
        >
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={ariaLabel}
          className="menu-pop-in absolute right-0 top-full z-20 mt-1 w-60 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-2 shadow-xl"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={itemClass(item.danger)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
