import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

interface PanelProps {
  title: string;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}

export function Panel({ title, children, className, actions }: PanelProps) {
  return (
    <div
      className={cn(
        'bg-[var(--panel)] border border-[var(--border)] rounded-2xl flex flex-col h-full min-h-0 overflow-hidden',
        className
      )}
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] bg-slate-900/30 select-none">
        <span className="text-sm font-semibold text-[var(--text-h)]">{title}</span>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className="flex-1 min-h-0 p-4 flex flex-col overflow-hidden">{children}</div>
    </div>
  );
}
