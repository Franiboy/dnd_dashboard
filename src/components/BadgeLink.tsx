import { type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Clickable pill badge for cross-module references: every badge that points at
 * another item (a session, a diary entry, ...) renders through this component
 * so jumping between modules looks and behaves the same everywhere.
 */
export type BadgeLinkVariant = 'session' | 'diary' | 'accent' | 'warning' | 'neutral';

const variantClasses: Record<BadgeLinkVariant, string> = {
  session: 'border border-violet-400/50 bg-violet-400/10 text-violet-200 hover:bg-violet-400/20',
  diary: 'border border-teal-400/35 bg-teal-400/10 text-teal-200 hover:bg-teal-400/20',
  accent:
    'border border-[var(--accent)]/20 bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20',
  warning:
    'border border-[var(--warning)]/20 bg-[var(--warning)]/10 text-[var(--warning)] hover:bg-[var(--warning)]/20',
  neutral: 'border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700',
};

const sizeClasses = {
  sm: 'text-[10px]',
  md: 'text-xs',
} as const;

interface BadgeLinkProps {
  /** React Router target of the referenced item, e.g. "/tagebuch?entry=7". */
  to: string;
  variant?: BadgeLinkVariant;
  size?: keyof typeof sizeClasses;
  title?: string;
  /** Runs before navigation; e.g. stop propagation inside clickable cards. */
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  className?: string;
  children: ReactNode;
}

export function BadgeLink({
  to,
  variant = 'accent',
  size = 'md',
  title,
  onClick,
  className = '',
  children,
}: BadgeLinkProps) {
  return (
    <Link
      to={to}
      title={title}
      onClick={onClick}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 font-medium transition ${variantClasses[variant]} ${sizeClasses[size]} ${className}`.trim()}
    >
      {children}
    </Link>
  );
}
