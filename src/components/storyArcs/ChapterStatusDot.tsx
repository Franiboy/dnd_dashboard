import type { StoryArcStatus } from '../../../shared/types';

/** Status dot of a chapter: green (active), hollow blue (planned), gray (completed). */
export function ChapterStatusDot({ status }: { status: StoryArcStatus }) {
  const styles = {
    active: 'bg-[var(--accent)] shadow-[0_0_8px_rgba(34,197,94,0.9)]',
    planned: 'border-2 border-sky-400',
    completed: 'bg-slate-500',
  } as const;
  return <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${styles[status]}`} />;
}
