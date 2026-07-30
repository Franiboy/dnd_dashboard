import { type ReactNode } from 'react';
import { BackButton } from './BackButton';

interface DashboardHeaderProps {
  title: string;
  children?: ReactNode;
}

export function DashboardHeader({ title, children }: DashboardHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h1 className="text-3xl font-bold text-[var(--text-h)]">{title}</h1>

      <div className="flex items-center gap-3">
        {children}
        <BackButton />
      </div>
    </div>
  );
}
