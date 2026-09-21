import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}

export function TabButton({ active, onClick, className, children }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-w-0 flex-1 truncate px-2 py-2 text-sm font-medium rounded-lg transition',
        active
          ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
          : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-[var(--text-h)]',
        className
      )}
    >
      {children}
    </button>
  );
}
