import { type ReactNode } from 'react';

interface DashboardHeaderProps {
  children?: ReactNode;
}

export function DashboardHeader({ children }: DashboardHeaderProps) {
  return (
    <div className="flex items-center justify-end mb-4">
      {children}
    </div>
  );
}
