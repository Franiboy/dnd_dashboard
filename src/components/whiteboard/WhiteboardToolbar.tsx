import type { ReactNode } from 'react';
import type { WhiteboardElement } from '../../../shared/types';
import { NOTE_COLORS, type WhiteboardTool } from './whiteboardShared';

interface WhiteboardToolbarProps {
  tool: WhiteboardTool;
  onToolChange: (tool: WhiteboardTool) => void;
  color: string;
  onColorChange: (color: string) => void;
  /** Selected note or text element enables the palette for recoloring. */
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
  {
    id: 'text',
    label: 'Text',
    icon: (
      <>
        <polyline points="4 7 4 4 20 4 20 7" />
        <line x1="12" y1="4" x2="12" y2="20" />
        <line x1="9" y1="20" x2="15" y2="20" />
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
  const showPalette = tool === 'note' || tool === 'text' || !!selectedNote;
  const activeColor = selectedNote ? selectedNote.color : color;

  const handleColor = (c: string) => {
    if (selectedNote) onNoteColorChange(c);
    else onColorChange(c);
  };

  const paletteTitle = selectedNote
    ? 'Farbe des ausgewählten Elements ändern'
    : tool === 'text'
      ? 'Textfarbe für neue Texte'
      : 'Farbe für neue Notizen';

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
            className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
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
              title={paletteTitle}
              onClick={() => handleColor(c)}
              style={{ backgroundColor: c }}
              className={`h-6 w-6 rounded-full border-2 transition-transform ${
                activeColor === c ? 'scale-110 border-white' : 'border-transparent hover:scale-105'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
