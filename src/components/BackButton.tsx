import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

interface BackButtonProps {
  to?: string;
  children?: ReactNode;
  className?: string;
}

export function BackButton({ to = '/', children = 'Zurück', className }: BackButtonProps) {
  return (
    <Link
      to={to}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 text-slate-300 border border-[var(--border)] hover:bg-slate-700 hover:text-[var(--text-h)] transition-colors ${className || ''}`}
    >
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
        <polyline points="15 18 9 12 15 6" />
      </svg>
      {children}
    </Link>
  );
}
