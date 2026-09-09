import { useRef, useState } from 'react';
import { useStoryArcs } from '../hooks/useStoryArcs';
import { formatArcLabel } from '../lib/storyArcs';
import { ChapterStatusDot } from './storyArcs/ChapterStatusDot';
import { ChapterTimeline } from './storyArcs/ChapterTimeline';
import { useDismiss } from './storyArcs/useDismiss';

/**
 * Global story-arc chapter filter, rendered in the app header. The trigger
 * shows the current selection; clicking it opens the campaign timeline panel
 * directly below the header (the panel anchors to the relative <header>).
 */
export function StoryArcFilter() {
  const { arcs, selectedArcId, setSelectedArcId } = useStoryArcs();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  const selectedArc =
    typeof selectedArcId === 'number' ? (arcs.find((a) => a.id === selectedArcId) ?? null) : null;

  const triggerTitle = selectedArc
    ? `Kapitel-Filter – ${formatArcLabel(selectedArc)}`
    : 'Kapitel-Filter (wirkt auf Sessions, Tagebuch und Welt)';

  return (
    <div ref={ref} className="flex items-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={triggerTitle}
        className={`chapter-serif inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold tracking-[0.04em] transition hover:brightness-110 ${
          selectedArc
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
            : 'border-[var(--border)] bg-slate-900/60 text-slate-300'
        }`}
      >
        {selectedArc ? (
          <>
            <ChapterStatusDot status={selectedArc.status} />
            {selectedArc.chapterNumber !== null && (
              <span className="chapter-caps text-[9.5px] text-amber-200/70">
                Kapitel {selectedArc.chapterNumber} ·
              </span>
            )}
            <span className="max-w-[12rem] truncate uppercase">{selectedArc.name}</span>
          </>
        ) : selectedArcId === 'none' ? (
          <>
            <span className="h-[7px] w-[7px] rounded-full border border-dashed border-slate-400" />
            Ohne Kapitel
          </>
        ) : (
          <>Alle Kapitel</>
        )}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-3 right-3 top-full z-30 mt-1 rounded-xl border border-amber-500/30 bg-gradient-to-b from-[#101a2e] to-[#0b1220] p-4 shadow-[0_22px_44px_rgba(0,0,0,0.5)]">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="chapter-caps text-[12px] text-amber-200/75">✦ Die Kampagne</span>
            <span className="hidden text-xs text-slate-500 sm:inline">
              Filter gilt für Sessions · Tagebuch · Welt
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
