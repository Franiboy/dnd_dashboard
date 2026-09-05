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

/** Display form of an arc: "▶ Name · Spieltag 3–7" (active marker, range). */
export function formatArcLabel(arc: StoryArc): string {
  const range =
    arc.gameDayStart !== null
      ? ` · Spieltag ${arc.gameDayStart}${arc.gameDayEnd !== null && arc.gameDayEnd !== arc.gameDayStart ? `–${arc.gameDayEnd}` : ''}`
      : '';
  const marker = arc.status === 'active' ? '▶ ' : arc.status === 'planned' ? '· ' : '';
  return `${marker}${arc.name}${range}`;
}

/** German status label of an arc ("Aktuell" / "Geplant" / "Abgeschlossen"). */
export function arcStatusLabel(arc: StoryArc): string {
  if (arc.status === 'active') return 'Aktuell';
  return arc.status === 'planned' ? 'Geplant' : 'Abgeschlossen';
}
