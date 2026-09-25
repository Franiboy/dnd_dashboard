import { useCallback, useEffect, useRef, useState } from 'react';
import type { SafeUser, UserRole } from '../../shared/types';
import { AppIcon } from './AppIcon';
import { Avatar } from './Avatar';
import { LanguageSwitcher } from './LanguageSwitcher';
import { useAuth } from '../hooks/useAuth';
import { useError } from '../hooks/useError';
import { useI18n } from '../hooks/useI18n';
import { useTheme } from '../hooks/useTheme';
import { buildTheme, isValidHexColor } from '../lib/color';

interface UserMenuProps {
  user: SafeUser;
  onLogout: () => void;
  /** Present while an admin simulates another user; renders the exit action. */
  onExitSimulation?: () => void;
}

const ROLE_MESSAGE_KEYS: Record<
  UserRole,
  'common.roles.guest' | 'common.roles.dungeonMaster' | 'common.roles.player'
> = {
  guest: 'common.roles.guest',
  dungeon_master: 'common.roles.dungeonMaster',
  player: 'common.roles.player',
};

/** Curated starting points; the default green stays one click away. */
const PRESET_COLORS = [
  '#22c55e',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#06b6d4',
];

const FALLBACK_PICKER_VALUE = '#22c55e';

const PREVIEW_CHIPS = [
  { name: '--accent', key: 'common.accent' },
  { name: '--accent-dim', key: 'common.accentDim' },
  { name: '--accent-2', key: 'common.complementary' },
  { name: '--panel', key: 'common.background' },
] as const;

export function UserMenu({ user, onLogout, onExitSimulation }: UserMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { updateUser } = useAuth();
  const { showError } = useError();
  const { themePrimary, preview, previewTheme, endPreview } = useTheme();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Last previewed value that still needs persisting; undefined = nothing pending.
  const pendingSave = useRef<string | null | undefined>(undefined);

  const persistTheme = useCallback(
    async (hex: string | null) => {
      try {
        const res = await fetch('/api/me/theme', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ primary: hex }),
          credentials: 'include',
        });
        const data = await res.json();
        if (!res.ok) throw new Error('request-failed');
        updateUser({ themePrimary: data.user.themePrimary });
      } catch {
        showError(t('common.colorSaveError'));
      } finally {
        endPreview();
      }
    },
    [endPreview, showError, t, updateUser]
  );

  /** Preview live and schedule the save (debounced while dragging the picker). */
  const applyThemeColor = useCallback(
    (hex: string | null) => {
      previewTheme(hex);
      pendingSave.current = hex;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        pendingSave.current = undefined;
        void persistTheme(hex);
      }, 500);
    },
    [previewTheme, persistTheme]
  );

  // Closing the menu flushes a pending color save so "pick, then click away"
  // still persists what was previewed.
  useEffect(() => {
    if (open || !saveTimer.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (pendingSave.current !== undefined) {
      const hex = pendingSave.current;
      pendingSave.current = undefined;
      void persistTheme(hex);
    }
  }, [open, persistTheme]);

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
  const roleLabel = [user.isAdmin ? t('common.admin') : null, t(ROLE_MESSAGE_KEYS[user.role])]
    .filter(Boolean)
    .join(' · ');

  const menuItemClass =
    'flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]';

  const savedColor = isValidHexColor(themePrimary) ? themePrimary : null;
  // While the picker is mid-edit the chips and the whole UI reflect the preview.
  const activeColor = preview ? preview.hex : savedColor;
  const previewTokens = buildTheme(activeColor);
  // Only shown inside the free-picker affordance when it isn't a preset swatch.
  const customColor = activeColor && !PRESET_COLORS.includes(activeColor) ? activeColor : null;

  return (
    <div ref={rootRef} className="relative shrink-0 self-stretch flex items-center">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('common.userMenu')}
        onClick={() => setOpen((o) => !o)}
        className="group flex rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <Avatar
          src={user.avatarUrl}
          name={user.displayName}
          className="w-9 h-9 ring-2 ring-slate-600 transition-shadow group-hover:ring-[var(--accent)]"
        />
      </button>

      {open && (
        // The panel starts exactly at the header's bottom border (row padding
        // py-2 + 1px border = 9px below the trigger) so its side borders form
        // a clean T-junction with the header line instead of poking above it.
        // The ::before patch extends the panel surface upward to hide the
        // header line behind the panel width. The negative left offsets cancel
        // the header row's px-3 sm:px-6 padding so the panel sits flush with
        // the left viewport edge.
        <div
          role="menu"
          aria-label={t('common.userMenu')}
          className="menu-pop-in absolute -left-3 top-full z-10 mt-[9px] w-60 border-x border-b border-[var(--border)] bg-[var(--panel)] p-2 shadow-xl before:absolute before:inset-x-0 before:bottom-full before:h-[9px] before:bg-[var(--panel)] before:content-[''] sm:-left-6"
        >
          <div className="mb-1.5 flex items-center gap-2.5 border-b border-[var(--border)] px-1 pb-2.5 pt-0.5">
            <Avatar src={user.avatarUrl} name={user.displayName} className="w-9 h-9" />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-sm font-semibold text-[var(--text-h)]">
                {user.displayName}
              </span>
              <span className="text-[11px] text-slate-400">{roleLabel}</span>
            </span>
          </div>

          <div className="border-b border-[var(--border)] px-1 py-2">
            <LanguageSwitcher id="user-menu-language" disabled={Boolean(onExitSimulation)} />
          </div>

          <div className="border-b border-[var(--border)] px-1 pb-2 pt-1.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                {t('common.designColor')}
              </span>
              {activeColor && (
                <button
                  type="button"
                  onClick={() => applyThemeColor(null)}
                  className="text-[11px] text-slate-400 transition-colors hover:text-[var(--text-h)]"
                >
                  {t('common.reset')}
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {PRESET_COLORS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  aria-label={t('common.designColorValue', { color: hex })}
                  aria-pressed={activeColor === hex}
                  onClick={() => applyThemeColor(hex)}
                  className={`h-6 w-6 rounded-full border border-white/10 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-h)] ${
                    activeColor === hex
                      ? 'ring-2 ring-[var(--text-h)] ring-offset-1 ring-offset-[var(--panel)]'
                      : ''
                  }`}
                  style={{ backgroundColor: hex }}
                />
              ))}
              {/* Free picker: a hue-wheel affordance clearly distinct from the
                  preset swatches; the native input rides invisibly on top. */}
              <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-[var(--border)]" />
              <span className="relative inline-flex" title={t('common.customColor')}>
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full ring-1 ring-white/20"
                  style={{
                    background:
                      'conic-gradient(from 180deg, #f87171, #fb923c, #fde047, #4ade80, #22d3ee, #60a5fa, #a78bfa, #f472b6, #f87171)',
                  }}
                >
                  {customColor ? (
                    <span
                      className="h-4 w-4 rounded-full border border-white/70 shadow-sm"
                      style={{ backgroundColor: customColor }}
                    />
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={3}
                      strokeLinecap="round"
                      className="h-3.5 w-3.5 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.7)]"
                    >
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  )}
                </span>
                <input
                  type="color"
                  aria-label={t('common.customColor')}
                  value={activeColor ?? FALLBACK_PICKER_VALUE}
                  onChange={(e) => applyThemeColor(e.target.value.toLowerCase())}
                  className="absolute inset-0 h-full w-full cursor-pointer rounded-full opacity-0"
                />
              </span>
            </div>
            {activeColor && (
              <div className="mt-2 flex items-center gap-1" aria-hidden="true">
                {PREVIEW_CHIPS.map(({ name, key }) => (
                  <span
                    key={name}
                    title={t(key)}
                    className="h-3 w-8 rounded-sm border border-white/10"
                    style={{ backgroundColor: previewTokens[name] }}
                  />
                ))}
              </div>
            )}
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
              <AppIcon id="undo" size={16} className="shrink-0" />
              {t('common.endSimulation')}
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
            <AppIcon id="logout" size={16} className="shrink-0" />
            {t('common.logout')}
          </button>
        </div>
      )}
    </div>
  );
}
