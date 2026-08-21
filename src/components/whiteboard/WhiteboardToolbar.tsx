import type { ReactNode } from 'react';
import { NOTE_COLORS, type WhiteboardTool } from './whiteboardShared';

interface WhiteboardToolbarProps {
  tool: WhiteboardTool;
  onToolChange: (tool: WhiteboardTool) => void;
  color: string;
  onColorChange: (color: string) => void;
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
    id: 'task',
    label: 'Aufgabe',
    icon: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M9 12l2 2 4-4" />
      </>
    ),
  },
  {
    id: 'arrow',
    label: 'Pfeil / Verbindung',
    icon: (
      <>
        <path d="M5 19L19 5" />
        <path d="M12 5h7v7" />
      </>
    ),
  },
  {
    id: 'link',
    label: 'Bild / Link',
    icon: (
      <>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
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
}: WhiteboardToolbarProps) {
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
      {(tool === 'note' || tool === 'task') && (
        <div className="grid grid-cols-2 gap-1 border-t border-[var(--border)] pt-2">
          {NOTE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Farbe ${c}`}
              onClick={() => onColorChange(c)}
              style={{ backgroundColor: c }}
              className={`h-6 w-6 rounded-full border-2 transition-transform ${
                color === c ? 'scale-110 border-white' : 'border-transparent hover:scale-105'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
