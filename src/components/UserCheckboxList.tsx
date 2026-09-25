import { useMemo, useState } from 'react';
import type { SafeUser } from '../../shared/types';
import { useI18n } from '../hooks/useI18n';
import { Avatar } from './Avatar';

interface UserCheckboxListProps {
  users: SafeUser[];
  selected: string[];
  onChange: (selected: string[]) => void;
  disabledIds?: string[];
  title?: string;
  placeholder?: string;
  emptyMessage?: string;
  className?: string;
}

export function UserCheckboxList({
  users,
  selected,
  onChange,
  disabledIds = [],
  title,
  placeholder,
  emptyMessage,
  className,
}: UserCheckboxListProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const disabledSet = useMemo(() => new Set(disabledIds), [disabledIds]);
  const resolvedPlaceholder = placeholder ?? t('shared.searchUsers');
  const resolvedEmptyMessage = emptyMessage ?? t('shared.noUsers');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.displayName.toLowerCase().includes(q));
  }, [users, query]);

  const toggle = (id: string) => {
    if (disabledSet.has(id)) return;
    if (selected.includes(id)) {
      onChange(selected.filter((x) => x !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <div
      className={`bg-slate-900/30 border border-[var(--border)] rounded-lg p-3 ${className || ''}`}
    >
      {title && <p className="text-xs text-slate-400 mb-2">{title}</p>}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={resolvedPlaceholder}
        aria-label={title ?? t('shared.searchUsers')}
        className="w-full px-3 py-1.5 mb-2 rounded bg-slate-900 border border-[var(--border)] text-sm text-[var(--text-h)] placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
      />
      <div className="max-h-40 overflow-auto space-y-1 pr-1">
        {filtered.length === 0 ? (
          <p className="text-xs text-slate-500 italic">{resolvedEmptyMessage}</p>
        ) : (
          filtered.map((u) => {
            const isDisabled = disabledSet.has(u.id);
            const isSelected = selected.includes(u.id);
            return (
              <button
                key={u.id}
                type="button"
                disabled={isDisabled}
                onClick={() => toggle(u.id)}
                className={`w-full flex items-center gap-3 px-2 py-1.5 rounded text-sm text-left transition ${
                  isDisabled
                    ? 'bg-slate-800/50 cursor-default opacity-70'
                    : isSelected
                      ? 'bg-slate-800 hover:bg-slate-700 cursor-pointer'
                      : 'hover:bg-slate-800/50 cursor-pointer'
                }`}
              >
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded border ${
                    isSelected
                      ? 'bg-[var(--accent)] border-[var(--accent)]'
                      : 'border-[var(--border)] bg-slate-900'
                  }`}
                >
                  {isSelected && (
                    <span className="text-[var(--accent-contrast)] text-xs font-bold">✓</span>
                  )}
                </span>
                <Avatar src={u.avatarUrl} name={u.displayName} className="w-6 h-6" />
                <span className="flex-1 text-[var(--text-h)]">{u.displayName}</span>
                {isDisabled && <span className="text-xs text-slate-500">{t('shared.you')}</span>}
              </button>
            );
          })
        )}
      </div>
      {selected.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {selected.map((id) => {
            const user = users.find((u) => u.id === id);
            if (!user) return null;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--accent)] text-[var(--accent-contrast)] text-xs font-medium"
              >
                <Avatar src={user.avatarUrl} name={user.displayName} className="w-4 h-4" />
                {user.displayName}
                {!disabledSet.has(id) && (
                  <button
                    type="button"
                    onClick={() => toggle(id)}
                    className="hover:text-white leading-none"
                    aria-label={t('shared.removeUser', { name: user.displayName })}
                  >
                    ×
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
