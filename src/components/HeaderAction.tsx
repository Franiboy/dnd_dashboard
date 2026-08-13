import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

interface HeaderActionProps {
  to?: string;
  onClick?: () => void;
  icon?: ReactNode;
  children: ReactNode;
  variant?: 'accent' | 'danger' | 'default';
  title?: string;
}

const variants = {
  accent: 'bg-[var(--accent)]/20 text-[var(--accent)] hover:bg-[var(--accent)]/30',
  danger: 'bg-[var(--danger)]/20 text-[var(--danger)] hover:bg-[var(--danger)]/30',
  default: 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-[var(--text-h)]',
};

export function HeaderAction({
  to,
  onClick,
  icon,
  children,
  variant = 'default',
  title,
}: HeaderActionProps) {
  const className = `inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${variants[variant]}`;

  if (to) {
    return (
      <Link to={to} className={className} title={title}>
        {icon}
        {children}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className} title={title}>
      {icon}
      {children}
    </button>
  );
}
