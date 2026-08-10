import type { ReactNode } from 'react';

interface TallyMarksProps {
  value: number;
  className?: string;
}

function Stroke() {
  return (
    <svg width="3" height="18" viewBox="0 0 3 18" className="shrink-0" aria-hidden="true">
      <line x1="1.5" y1="1" x2="1.5" y2="17" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

function FiveGroup() {
  return (
    <svg width="15" height="18" viewBox="0 0 15 18" className="shrink-0" aria-hidden="true">
      <line x1="1.5" y1="1" x2="1.5" y2="17" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <line x1="5" y1="1" x2="5" y2="17" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <line x1="8.5" y1="1" x2="8.5" y2="17" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <line x1="12" y1="1" x2="12" y2="17" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <line x1="1" y1="16" x2="14" y2="2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

export function TallyMarks({ value, className }: TallyMarksProps) {
  const groups = Math.max(0, Math.floor(value / 5));
  const remainder = Math.max(0, value % 5);

  if (groups === 0 && remainder === 0) {
    return <span className={`text-xs text-slate-500 ${className ?? ''}`}>0</span>;
  }

  const marks: ReactNode[] = [];
  for (let g = 0; g < groups; g++) marks.push(<FiveGroup key={`g${g}`} />);
  for (let r = 0; r < remainder; r++) marks.push(<Stroke key={`r${r}`} />);

  return <span className={`inline-flex items-center gap-[3px] ${className ?? ''}`}>{marks}</span>;
}