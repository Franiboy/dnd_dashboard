import { useState } from 'react';
import { useEntityDialog } from '../../hooks/useEntityDialog';
import { splitEntityLabel } from '../../lib/entityLabels';

import type { EntityType } from '../../../shared/types';

export interface BadgeListProps {
  items: string[];
  variant: 'person' | 'organization' | 'location' | 'item';
}

const badgeStyles = {
  person: 'bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20',
  organization: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  location: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
  item: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
};

const badgeTypeMap: Record<BadgeListProps['variant'], EntityType> = {
  person: 'persons',
  organization: 'organizations',
  location: 'locations',
  item: 'items',
};

const badgePillClass =
  'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium cursor-pointer hover:brightness-110 transition';

/**
 * Wrappable list of entity badges for one diary entry. On small screens the
 * badges collapse into a single count chip per type that expands on tap, and
 * all chips share one row around the entry content; from md upwards every
 * type keeps its own badge row as before.
 */
export function BadgeList({ items, variant }: BadgeListProps) {
  const { openEntity } = useEntityDialog();
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  return (
    // display:contents on mobile lets the chip and any expanded badges join
    // the surrounding shared row; md+ turns this into the per-type row.
    <div className="contents md:flex md:flex-wrap md:gap-2 md:mb-3">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className={`md:hidden ${badgePillClass} ${badgeStyles[variant]}`}
      >
        {expanded ? '−' : '+'}
        {items.length}
      </button>
      <div className={`flex-wrap gap-2 ${expanded ? 'contents' : 'hidden md:flex'}`}>
        {items.map((item) => {
          // Items are qualified labels ("Name (Qualifier)") - parse before
          // opening so homonyms resolve to the exact entity.
          const { name, qualifier } = splitEntityLabel(item);
          return (
            <span
              key={item}
              onClick={() => openEntity(name, badgeTypeMap[variant], undefined, qualifier)}
              title="Öffnen"
              className={`${badgePillClass} ${badgeStyles[variant]}`}
            >
              {item}
            </span>
          );
        })}
      </div>
    </div>
  );
}
