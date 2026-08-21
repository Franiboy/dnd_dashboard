import type { WhiteboardTaskStatus } from '../../../shared/types';

export type WhiteboardTool = 'select' | 'note' | 'task' | 'arrow' | 'link';

export const NOTE_COLORS: readonly string[] = [
  '#facc15',
  '#fb923c',
  '#f87171',
  '#f472b6',
  '#a78bfa',
  '#60a5fa',
  '#34d399',
];

export const ARROW_COLOR = '#94a3b8';

export const TASK_STATUS_ORDER: readonly WhiteboardTaskStatus[] = ['open', 'in_progress', 'done'];

export const TASK_STATUS_META: Record<WhiteboardTaskStatus, { label: string; className: string }> =
  {
    open: { label: 'Offen', className: 'bg-slate-600 text-slate-100' },
    in_progress: { label: 'In Arbeit', className: 'bg-[var(--warning)] text-slate-900' },
    done: { label: 'Erledigt', className: 'bg-[var(--accent)] text-slate-900' },
  };

export function nextTaskStatus(status: WhiteboardTaskStatus): WhiteboardTaskStatus {
  const index = TASK_STATUS_ORDER.indexOf(status);
  return TASK_STATUS_ORDER[(index + 1) % TASK_STATUS_ORDER.length];
}
