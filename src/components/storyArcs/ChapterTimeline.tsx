import type { StoryArc } from '../../../shared/types';
import { arcStatusLabel, sortArcsChronologically } from '../../lib/storyArcs';
import { ChapterStatusDot } from './ChapterStatusDot';

interface ChapterTimelineProps {
  arcs: StoryArc[];
  /** Highlighted value; same shape as the global filter selection. */
  selected: number | 'none' | null;
  onSelect: (value: number | 'none' | null) => void;
  /** 'filter' shows the leading "Alle Kapitel" segment, 'assign' does not. */
  mode?: 'filter' | 'assign';
  className?: string;
}

function rangeLabel(arc: StoryArc): string {
  if (arc.gameDayStart === null) return '';
  const end =
    arc.gameDayEnd !== null && arc.gameDayEnd !== arc.gameDayStart ? `–${arc.gameDayEnd}` : '';
  return `Spieltag ${arc.gameDayStart}${end}`;
}

const segmentStyles = {
  active: 'border-[var(--accent)]/55 bg-[#22c55e]/10 shadow-[0_0_18px_rgba(34,197,94,0.18)]',
  planned: 'border-sky-400/40 border-dashed bg-transparent',
  completed: 'border-amber-500/30 bg-amber-500/5 opacity-60',
} as const;

const segmentNameStyles = {
  active: 'text-[var(--text-h)]',
  planned: 'text-sky-200',
  completed: 'text-amber-100/90',
} as const;

const pickedStyles = 'outline outline-2 outline-offset-2 outline-[var(--accent)]/60';

/**
 * The campaign as a horizontal chapter timeline. Used as the header filter
 * panel (mode="filter", with "Alle Kapitel") and as the inline assignment
 * picker (mode="assign").
 */
export function ChapterTimeline({
  arcs,
  selected,
  onSelect,
  mode = 'filter',
  className = '',
}: ChapterTimelineProps) {
  const sorted = sortArcsChronologically(arcs);
  const nonePicked = mode === 'assign' ? selected === null : selected === 'none';

  return (
    <div
      role="group"
      aria-label="Kapitel wählen"
      className={`flex items-stretch gap-2 overflow-x-auto pb-1 ${className}`}
    >
      {mode === 'filter' && (
        <button
          type="button"
          onClick={() => onSelect(null)}
          aria-pressed={selected === null}
          className={`flex min-w-[7.5rem] flex-none items-center justify-center rounded-md border border-[var(--border)] bg-slate-800/50 px-3 py-2 text-[12.5px] font-semibold text-slate-300 transition hover:brightness-110 ${
            selected === null ? pickedStyles : ''
          }`}
        >
          Alle Kapitel
        </button>
      )}
      {sorted.map((arc) => (
        <button
          key={arc.id}
          type="button"
          onClick={() => onSelect(arc.id)}
          aria-pressed={selected === arc.id}
          className={`relative min-w-[9rem] flex-1 rounded-md border px-3 pb-2.5 pt-2 text-left transition hover:brightness-110 ${
            segmentStyles[arc.status]
          } ${selected === arc.id ? pickedStyles : ''}`}
        >
          <span className="chapter-caps block text-[9.5px] text-amber-200/60">
            {arc.chapterNumber !== null ? `Kapitel ${arc.chapterNumber}` : 'Sonderkapitel'}
          </span>
          <span
            className={`chapter-serif mt-0.5 block truncate text-[13.5px] font-semibold ${segmentNameStyles[arc.status]}`}
          >
            {arc.name}
          </span>
          <span className="mt-0.5 block text-[10.5px] text-slate-500">
            {arcStatusLabel(arc)}
            {rangeLabel(arc) ? ` · ${rangeLabel(arc)}` : ''}
          </span>
          <span className="absolute right-2.5 top-3">
            <ChapterStatusDot status={arc.status} />
          </span>
        </button>
      ))}
      <button
        type="button"
        onClick={() => onSelect('none')}
        aria-pressed={nonePicked}
        title="Einträge und Sessions ohne Kapitelzuordnung (One-Shots)"
        className={`relative min-w-[8.5rem] flex-1 rounded-md border border-dashed border-[var(--border)] bg-transparent px-3 pb-2.5 pt-2 text-left transition hover:brightness-110 ${
          nonePicked ? pickedStyles : ''
        }`}
      >
        <span className="chapter-caps block text-[9.5px] text-slate-500">Ohne Kapitel</span>
        <span className="mt-0.5 block truncate text-[13.5px] font-semibold text-slate-300">
          One-Shots
        </span>
        <span className="mt-0.5 block text-[10.5px] text-slate-600">Sonderabende</span>
      </button>
    </div>
  );
}
