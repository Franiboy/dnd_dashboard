import { useStoryArcs } from '../../hooks/useStoryArcs';
import { ChapterTimeline } from './ChapterTimeline';

/** Book icon for the "Kapitel" SideDrawer rail button (16px stroke style). */
export function ChapterFilterIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

/**
 * Content of the "Kapitel" SideDrawer item: the campaign timeline as a
 * vertical card list. The selection lives in StoryArcProvider and filters
 * Sessions, Diary and World. Pages wrap this in their own SideDrawerItem
 * (SideDrawer reads id/label/icon from its direct children).
 */
export function ChapterFilterPanel() {
  const { arcs, selectedArcId, setSelectedArcId } = useStoryArcs();

  return (
    <div className="p-2">
      <h3 className="chapter-caps text-[12px] text-amber-200/75">✦ Die Kampagne</h3>
      <div className="mt-3">
        <ChapterTimeline
          arcs={arcs}
          selected={selectedArcId}
          mode="filter"
          layout="vertical"
          onSelect={setSelectedArcId}
        />
      </div>
      <p className="mt-3 text-xs text-slate-500">Filter gilt für Sessions · Tagebuch · Welt</p>
    </div>
  );
}
