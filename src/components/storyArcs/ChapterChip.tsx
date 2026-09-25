import type { StoryArc } from '../../../shared/types';
import { useI18n } from '../../hooks/useI18n';
import { ChapterStatusDot } from './ChapterStatusDot';

interface ChapterChipProps {
  /** The arc to display; null renders the dashed "Ohne Kapitel" chip. */
  arc: StoryArc | null;
  /** Renders an interactive button when provided, otherwise a static chip. */
  onClick?: () => void;
  className?: string;
  title?: string;
  disabled?: boolean;
}

// Medallion look per lifecycle status: brass frame for active/completed
// (completed dimmed), dashed blue outline for planned, dashed neutral for
// members without a chapter.
const statusChipStyles = {
  active: 'border-amber-500/45 bg-amber-500/10 text-amber-200 outline-amber-500/20',
  planned: 'border-sky-400/45 border-dashed bg-sky-400/5 text-sky-200 outline-sky-400/15',
  completed: 'border-amber-500/30 bg-amber-500/5 text-amber-200/70 outline-amber-500/10',
} as const;

/** Chapter display chip ("medallion"): serif arc name + chapter number. */
export function ChapterChip({ arc, onClick, className = '', title, disabled }: ChapterChipProps) {
  const { t, formatNumber } = useI18n();
  const base =
    'chapter-serif inline-flex max-w-full items-center gap-2 whitespace-nowrap rounded-[4px] border px-3 py-1 text-[13px] font-semibold tracking-[0.04em] outline outline-1 outline-offset-[3px] transition hover:brightness-110';
  const style = arc
    ? statusChipStyles[arc.status]
    : 'border-dashed border-[var(--border)] bg-slate-800/40 text-slate-400 outline-transparent font-sans font-medium tracking-normal';

  const content = arc ? (
    <>
      <ChapterStatusDot status={arc.status} />
      {arc.chapterNumber !== null && (
        <span className="chapter-caps whitespace-nowrap text-[9.5px] opacity-70">
          {t('sessions.storyArcs.chapterNumber', { number: formatNumber(arc.chapterNumber) })} ·
        </span>
      )}
      <span className="min-w-0 truncate uppercase">{arc.name}</span>
    </>
  ) : (
    <>
      <span className="h-[7px] w-[7px] shrink-0 rounded-full border border-dashed border-slate-400" />
      <span className="min-w-0 truncate">{t('sessions.storyArcs.noChapter')}</span>
    </>
  );

  if (onClick === undefined) {
    return (
      <span className={`${base} ${style} ${className}`} title={title}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`${base} ${style} ${className} cursor-pointer disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {content}
    </button>
  );
}
