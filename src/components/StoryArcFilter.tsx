import { useRef, useState } from 'react';
import type { StoryArc } from '../../shared/types';
import { useI18n } from '../hooks/useI18n';
import { useStoryArcs } from '../hooks/useStoryArcs';
import type { TFunction } from '../i18n';
import { ChapterStatusDot } from './storyArcs/ChapterStatusDot';
import { ChapterTimeline } from './storyArcs/ChapterTimeline';
import { useDismiss } from './storyArcs/useDismiss';

function localizedArcLabel(arc: StoryArc, t: TFunction): string {
  const parts: string[] = [];
  if (arc.chapterNumber !== null) {
    parts.push(t('shell.chapterFilter.chapterNumber', { number: arc.chapterNumber }));
  }
  parts.push(arc.name);
  if (arc.gameDayStart !== null) {
    parts.push(
      arc.gameDayEnd !== null && arc.gameDayEnd !== arc.gameDayStart
        ? t('shell.chapterFilter.gameDayRange', {
            start: arc.gameDayStart,
            end: arc.gameDayEnd,
          })
        : t('shell.chapterFilter.gameDay', { day: arc.gameDayStart })
    );
  }
  return parts.join(' · ');
}

/**
 * Global story-arc chapter filter, rendered in the header between the user
 * menu and the app switcher. The trigger shows the current selection; clicking
 * it opens the campaign timeline panel directly below the header (the panel
 * anchors to the relative <header> and spans its full width).
 */
export function StoryArcFilter() {
  const { t } = useI18n();
  const { arcs, selectedArcId, setSelectedArcId } = useStoryArcs();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  const selectedArc =
    typeof selectedArcId === 'number' ? (arcs.find((a) => a.id === selectedArcId) ?? null) : null;

  const triggerTitle = selectedArc
    ? t('shell.chapterFilter.title', { label: localizedArcLabel(selectedArc, t) })
    : t('shell.chapterFilter.defaultTitle');

  return (
    <div ref={ref} className="flex min-w-0 max-w-full items-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={triggerTitle}
        title={triggerTitle}
        className={`inline-flex min-h-11 min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 transition hover:brightness-110 ${
          selectedArc
            ? 'border-amber-400/60 bg-amber-400/10 text-amber-100'
            : 'border-[var(--border)] bg-slate-900/60 text-slate-300'
        }`}
      >
        <span
          className={`chapter-caps text-[10px] leading-none ${selectedArc ? 'text-amber-300/80' : 'text-amber-200/60'}`}
        >
          ✦
        </span>
        {selectedArc ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="chapter-caps whitespace-nowrap text-[10px] leading-none text-amber-200/70">
              {selectedArc.chapterNumber !== null
                ? t('shell.chapterFilter.chapterNumber', { number: selectedArc.chapterNumber })
                : t('shell.chapterFilter.chapter')}
            </span>
            <span className="chapter-serif truncate text-[13px] font-semibold leading-none">
              {selectedArc.name}
            </span>
            <ChapterStatusDot status={selectedArc.status} />
          </span>
        ) : selectedArcId === 'none' ? (
          <span className="chapter-serif whitespace-nowrap text-[13px] font-semibold leading-none">
            {t('shell.chapterFilter.none')}
          </span>
        ) : (
          <span className="chapter-serif whitespace-nowrap text-[13px] font-semibold leading-none">
            {t('shell.chapterFilter.all')}
          </span>
        )}
        <svg
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          role="region"
          aria-label={t('shell.chapterFilter.campaign')}
          className="menu-pop-in absolute left-3 right-3 top-full z-50 mt-1 rounded-xl border border-amber-500/30 bg-gradient-to-b from-[#101a2e] to-[#0b1220] p-4 shadow-[0_22px_44px_rgba(0,0,0,0.5)] sm:left-6 sm:right-6"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="chapter-caps text-[12px] text-amber-200/75">
              {t('shell.chapterFilter.campaign')}
            </span>
            <span className="hidden text-xs text-slate-500 sm:inline">
              {t('shell.chapterFilter.legend')}
            </span>
          </div>
          <ChapterTimeline
            arcs={arcs}
            selected={selectedArcId}
            mode="filter"
            onSelect={(value) => {
              setSelectedArcId(value);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
