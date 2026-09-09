import type { StoryArc } from '../../shared/types';

/** Pure filter predicate shared by all arc-filtered pages. */
export function arcMatchesFilter(
  selected: number | 'none' | null,
  arcId: number | null | undefined
): boolean {
  if (selected === null) return true;
  if (selected === 'none') return arcId == null;
  return arcId === selected;
}

/**
 * Display form of an arc: "Kapitel 2 · Name · Spieltag 3–7" (used for titles
 * and aria labels; the chapter chips show the same information visually).
 */
export function formatArcLabel(arc: StoryArc): string {
  const chapter = arc.chapterNumber !== null ? `Kapitel ${arc.chapterNumber} · ` : '';
  const range =
    arc.gameDayStart !== null
      ? ` · Spieltag ${arc.gameDayStart}${arc.gameDayEnd !== null && arc.gameDayEnd !== arc.gameDayStart ? `–${arc.gameDayEnd}` : ''}`
      : '';
  return `${chapter}${arc.name}${range}`;
}

/** German status label of an arc ("Aktuell" / "Geplant" / "Abgeschlossen"). */
export function arcStatusLabel(arc: StoryArc): string {
  if (arc.status === 'active') return 'Aktuell';
  return arc.status === 'planned' ? 'Geplant' : 'Abgeschlossen';
}

/**
 * Chronological chapter order for timelines: numbered arcs first (by chapter
 * number), unnumbered ones last by game-day range, then creation date. The
 * repository list is intentionally ordered active-first instead, so the
 * timeline sorts for itself.
 */
export function sortArcsChronologically(arcs: StoryArc[]): StoryArc[] {
  return [...arcs].sort((a, b) => {
    if (
      a.chapterNumber !== null &&
      b.chapterNumber !== null &&
      a.chapterNumber !== b.chapterNumber
    ) {
      return a.chapterNumber - b.chapterNumber;
    }
    if (a.chapterNumber !== null) return -1;
    if (b.chapterNumber !== null) return 1;
    const aStart = a.gameDayStart ?? Number.MAX_SAFE_INTEGER;
    const bStart = b.gameDayStart ?? Number.MAX_SAFE_INTEGER;
    if (aStart !== bStart) return aStart - bStart;
    return a.createdAt.localeCompare(b.createdAt);
  });
}
