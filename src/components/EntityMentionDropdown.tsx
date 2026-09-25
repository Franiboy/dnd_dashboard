import type { EntityType } from '../../shared/types';
import { useI18n } from '../hooks/useI18n';
import { getEntityTypeLabel } from '../lib/entityLabels';
import type { MentionSuggestion } from '../lib/entityMention';

const badgeStyles: Record<EntityType, string> = {
  persons: 'bg-[var(--accent)]/15 text-[var(--accent)]',
  organizations: 'bg-blue-500/15 text-blue-400',
  locations: 'bg-amber-500/15 text-amber-400',
  items: 'bg-emerald-500/15 text-emerald-400',
};

interface EntityMentionDropdownProps {
  suggestions: MentionSuggestion[];
  activeIndex: number;
  position: { top: number; left: number };
  onPick: (suggestion: MentionSuggestion) => void;
  onHover: (index: number) => void;
}

export function EntityMentionDropdown({
  suggestions,
  activeIndex,
  position,
  onPick,
  onHover,
}: EntityMentionDropdownProps) {
  const { t } = useI18n();

  return (
    <div
      data-entity-mention="dropdown"
      className="fixed z-[100] w-72 max-h-64 overflow-auto rounded-lg border border-[var(--border)] bg-slate-900 shadow-xl"
      style={{ top: position.top, left: position.left }}
      role="listbox"
      aria-label={t('world.mention.label')}
    >
      {suggestions.length === 0 ? (
        <p className="px-3 py-2 text-xs text-slate-500">{t('world.mention.noResults')}</p>
      ) : (
        suggestions.map((suggestion, index) => (
          <button
            key={`${suggestion.type}-${suggestion.canonical}-${suggestion.qualifier}`}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            aria-label={`${suggestion.label} — ${getEntityTypeLabel(suggestion.type, t)}`}
            onMouseDown={(e) => {
              // Keep the Quill focus so the mention range stays valid.
              e.preventDefault();
              onPick(suggestion);
            }}
            onMouseEnter={() => onHover(index)}
            className={`flex w-full items-start gap-2 px-3 py-2 text-left transition ${
              index === activeIndex ? 'bg-[var(--accent)]/15' : 'hover:bg-slate-800'
            }`}
          >
            <span
              className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${badgeStyles[suggestion.type]}`}
            >
              {getEntityTypeLabel(suggestion.type, t)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-[var(--text-h)]">
                {suggestion.label}
              </span>
              {suggestion.miniSummary && (
                <span className="block truncate text-xs text-slate-500">
                  {suggestion.miniSummary}
                </span>
              )}
            </span>
          </button>
        ))
      )}
    </div>
  );
}
