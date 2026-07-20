import type { ReactNode } from 'react';

interface GridPanelProps {
  title: string;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}

export function GridPanel({ title, children, className, actions }: GridPanelProps) {
  return (
    <div
      className={`bg-[var(--panel)] border border-[var(--border)] rounded-2xl flex flex-col h-full overflow-hidden ${className || ''}`}
    >
      <div className="grid-panel-header flex items-center justify-between px-4 py-2 border-b border-[var(--border)] bg-slate-900/30 cursor-move select-none">
        <span className="text-sm font-semibold text-[var(--text-h)]">{title}</span>
        <div className="flex items-center gap-2">
          {actions}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-slate-500"
          >
            <circle cx="9" cy="9" r="1" />
            <circle cx="9" cy="15" r="1" />
            <circle cx="15" cy="9" r="1" />
            <circle cx="15" cy="15" r="1" />
          </svg>
        </div>
      </div>
      <div className="flex-1 min-h-0 p-4 flex flex-col overflow-hidden">{children}</div>
    </div>
  );
}
