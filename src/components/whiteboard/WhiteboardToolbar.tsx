import type { ReactNode } from 'react';
import type { WhiteboardElement } from '../../../shared/types';
import { NOTE_COLORS, type WhiteboardTool } from './whiteboardShared';

interface WhiteboardToolbarProps {
  tool: WhiteboardTool;
  onToolChange: (tool: WhiteboardTool) => void;
  color: string;
  onColorChange: (color: string) => void;
  /** Selected note enables the palette for recoloring existing elements. */
  selectedNote: WhiteboardElement | null;
  onNoteColorChange: (color: string) => void;
}

const TOOL_BUTTONS: {
  id: WhiteboardTool;
  label: string;
  icon: ReactNode;
}[] = [
  {
    id: 'select',
    label: 'Auswählen & verschieben',
    icon: <path d="M4 3l7 17 2.5-6.5L20 11z" />,
  },
  {
    id: 'note',
    label: 'Haftnotiz',
    icon: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M15 20v-5h5" />
      </>
    ),
  },
];

const COMMON_PROPS = {
  xmlns: 'http://www.w3.org/2000/svg',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  viewBox: '0 0 24 24',
  width: 18,
  height: 18,
};

export function WhiteboardToolbar({
  tool,
  onToolChange,
  color,
  onColorChange,
  selectedNote,
  onNoteColorChange,
}: WhiteboardToolbarProps) {
  const showPalette = tool === 'note' || !!selectedNote;
  const activeColor = selectedNote ? selectedNote.color : color;

  const handleColor = (c: string) => {
    if (selectedNote) onNoteColorChange(c);
    else onColorChange(c);
  };

  return (
    <div className="absolute left-3 top-3 z-10 flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel)]/95 p-2 shadow-lg backdrop-blur">
      <div className="flex flex-col gap-1">
        {TOOL_BUTTONS.map((button) => (
          <button
            key={button.id}
            type="button"
            title={button.label}
            aria-label={button.label}
            onClick={() => onToolChange(button.id)}
            onMouseDown={(e) => e.preventDefault()}
            className={`flex h-9 w-9 cursor-pointer select-none items-center justify-center rounded-lg transition-colors ${
              tool === button.id
                ? 'bg-[var(--accent)] text-slate-900'
                : 'text-slate-300 hover:bg-slate-700/60 hover:text-white'
            }`}
          >
            <svg {...COMMON_PROPS}>{button.icon}</svg>
          </button>
        ))}
      </div>
      {showPalette && (
        <div className="grid grid-cols-2 gap-1 border-t border-[var(--border)] pt-2">
          {NOTE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Farbe ${c}`}
              title={
                selectedNote ? 'Farbe der ausgewählten Notiz ändern' : 'Farbe für neue Notizen'
              }
              onClick={() => handleColor(c)}
              onMouseDown={(e) => e.preventDefault()}
              style={{ backgroundColor: c }}
              className={`h-6 w-6 cursor-pointer select-none rounded-full border-2 transition-transform ${
                activeColor === c ? 'scale-110 border-white' : 'border-transparent hover:scale-105'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
