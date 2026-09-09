import { useRef, useState } from 'react';
import type { StoryArc } from '../../../shared/types';
import { formatArcLabel } from '../../lib/storyArcs';
import { ChapterChip } from './ChapterChip';
import { ChapterTimeline } from './ChapterTimeline';
import { useDismiss } from './useDismiss';

interface ArcAssignPickerProps {
  arcs: StoryArc[];
  /** Assigned arc of the member; null = "Ohne Kapitel". */
  value: number | null;
  onChange: (arcId: number | null) => void;
  disabled?: boolean;
  align?: 'left' | 'right';
  className?: string;
}

/**
 * Chapter chip + inline timeline popover for assigning one member (a session
 * or diary entry) to a story arc. The chip itself displays the assignment.
 */
export function ArcAssignPicker({
  arcs,
  value,
  onChange,
  disabled = false,
  align = 'left',
  className = '',
}: ArcAssignPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  const arc = arcs.find((a) => a.id === value) ?? null;

  return (
    <div ref={ref} className={`relative inline-flex ${className}`}>
      <ChapterChip
        arc={arc}
        disabled={disabled || arcs.length === 0}
        title={arc ? `Kapitel wechseln – ${formatArcLabel(arc)}` : 'Kapitel zuweisen'}
        onClick={disabled ? undefined : () => setOpen((o) => !o)}
      />
      {open && (
        <div
          className={`absolute top-full z-30 mt-3 w-[min(42rem,calc(100vw-3rem))] rounded-xl border border-amber-500/30 bg-[#0b1220] p-3 shadow-[0_18px_40px_rgba(0,0,0,0.55)] ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <ChapterTimeline
            arcs={arcs}
            selected={value ?? 'none'}
            mode="assign"
            onSelect={(v) => {
              onChange(v === 'none' ? null : v);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
