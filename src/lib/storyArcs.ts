import type { StoryArc } from '../../shared/types';
import { createTranslator, type TranslationKey, type TFunction } from '../i18n/messages';

type NumberFormatter = (value: number) => string;
const defaultStoryArcTranslator = createTranslator('de');

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
 * The legacy defaults keep this pure helper usable by callers that have not
 * migrated to the i18n context yet.
 */
export function formatArcLabel(
  arc: StoryArc,
  t: TFunction = defaultStoryArcTranslator,
  formatNumber: NumberFormatter = String
): string {
  const chapter =
    arc.chapterNumber !== null
      ? `${t('sessions.storyArcs.chapterNumber', {
          number: formatNumber(arc.chapterNumber),
        })} · `
      : '';
  const range =
    arc.gameDayStart !== null
      ? ` · ${
          arc.gameDayEnd !== null && arc.gameDayEnd !== arc.gameDayStart
            ? t('sessions.storyArcs.gameDayRange', {
                start: formatNumber(arc.gameDayStart),
                end: formatNumber(arc.gameDayEnd),
              })
            : t('sessions.storyArcs.gameDay', { day: formatNumber(arc.gameDayStart) })
        }`
      : '';
  return `${chapter}${arc.name}${range}`;
}

export function arcStatusKey(arc: StoryArc): TranslationKey {
  return `sessions.storyArcs.status.${arc.status}`;
}

/** Localized lifecycle label of an arc. */
export function arcStatusLabel(arc: StoryArc, t: TFunction = defaultStoryArcTranslator): string {
  return t(arcStatusKey(arc));
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
