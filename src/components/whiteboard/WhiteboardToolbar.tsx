import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { WhiteboardElement, WhiteboardPatch } from '../../../shared/types';
import {
  NOTE_COLORS,
  NO_BORDER,
  NO_FILL,
  STROKE_WIDTHS,
  isShapeTool,
  type WhiteboardTool,
} from './whiteboardShared';

interface WhiteboardToolbarProps {
  tool: WhiteboardTool;
  onToolChange: (tool: WhiteboardTool) => void;
  color: string;
  /** Default outline/note color for newly created elements. */
  onColorChange: (color: string) => void;
  /** Default interior fill for new shapes; NO_FILL means transparent. */
  fillColor: string;
  onFillColorChange: (fill: string) => void;
  /** Default outline width for new shapes and strokes. */
  strokeWidth: number;
  onStrokeWidthChange: (width: number) => void;
  /** Selected recolorable element enables editing its appearance. */
  selectedElement: WhiteboardElement | null;
  /** Applies an appearance patch to the currently selected element. */
  onUpdateSelected: (patch: WhiteboardPatch) => void;
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

const DRAWING_TOOLS: {
  id: WhiteboardTool;
  label: string;
  icon: ReactNode;
}[] = [
  {
    id: 'draw',
    label: 'Freihand',
    icon: <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />,
  },
  {
    id: 'rect',
    label: 'Rechteck',
    icon: <rect x="4" y="5" width="16" height="14" rx="1" />,
  },
  {
    id: 'ellipse',
    label: 'Ellipse',
    icon: <ellipse cx="12" cy="12" rx="9" ry="7" />,
  },
  {
    id: 'triangle',
    label: 'Dreieck',
    icon: <polygon points="12,4 21,20 3,20" />,
  },
  {
    id: 'diamond',
    label: 'Raute',
    icon: <polygon points="12,3 21,12 12,21 3,12" />,
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
  fillColor,
  onFillColorChange,
  strokeWidth,
  onStrokeWidthChange,
  selectedElement,
  onUpdateSelected,
}: WhiteboardToolbarProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  // The drawing tools live in a flyout behind the pen button and are not
  // part of the always-visible toolbar column.
  const [drawingToolsOpen, setDrawingToolsOpen] = useState(false);
  const drawingActive = tool === 'draw' || isShapeTool(tool);

  useEffect(() => {
    if (!drawingActive) setDrawingToolsOpen(false);
  }, [drawingActive]);

  // Clicks outside the toolbar close the flyout.
  useEffect(() => {
    if (!drawingToolsOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setDrawingToolsOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [drawingToolsOpen]);

  const selectedType = selectedElement?.type ?? null;
  // Which control groups are relevant: driven either by the active tool
  // (defaults for new elements) or by the selected element (recoloring).
  const noteContext = tool === 'note' || selectedType === 'note';
  const drawContext = tool === 'draw' || selectedType === 'stroke';
  const shapeContext = isShapeTool(tool) || selectedType === 'shape';
  const showControls = noteContext || drawContext || shapeContext;

  const activeColor = selectedElement ? selectedElement.color : color;
  const activeWidth =
    selectedElement && (selectedType === 'shape' || selectedType === 'stroke')
      ? selectedElement.strokeWidth
      : strokeWidth;
  const activeFill =
    selectedElement && selectedType === 'shape'
      ? (selectedElement.fillColor ?? NO_FILL)
      : fillColor;

  const handleColor = (c: string) => {
    if (selectedElement) onUpdateSelected({ color: c });
    else onColorChange(c);
  };

  const handleFill = (c: string | null) => {
    if (selectedElement && selectedType === 'shape') {
      onUpdateSelected({ fillColor: c });
      return;
    }
    onFillColorChange(c ?? NO_FILL);
  };

  const handleWidth = (w: number) => {
    if (selectedElement && (selectedType === 'shape' || selectedType === 'stroke')) {
      onUpdateSelected({ strokeWidth: w });
      return;
    }
    onStrokeWidthChange(w);
  };

  const renderToolButton = (button: { id: WhiteboardTool; label: string; icon: ReactNode }) => (
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
  );

  const swatchButtonClass = (active: boolean, outlined = false) =>
    `h-6 w-6 cursor-pointer select-none rounded-full border-2 transition-transform ${
      active
        ? 'scale-110 border-white'
        : outlined
          ? 'border-slate-500 hover:scale-105'
          : 'border-transparent hover:scale-105'
    }`;

  const renderPenButton = () => (
    <button
      key="pen"
      type="button"
      title="Zeichnen"
      aria-label="Zeichnen"
      onClick={() => setDrawingToolsOpen((open) => !open)}
      onMouseDown={(e) => e.preventDefault()}
      className={`flex h-9 w-9 cursor-pointer select-none items-center justify-center rounded-lg transition-colors ${
        drawingActive
          ? 'bg-[var(--accent)] text-slate-900'
          : 'text-slate-300 hover:bg-slate-700/60 hover:text-white'
      }`}
    >
      <svg {...COMMON_PROPS}>
        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
      </svg>
    </button>
  );

  const renderFlyoutItem = (item: { id: WhiteboardTool; label: string; icon: ReactNode }) => (
    <button
      key={item.id}
      type="button"
      title={item.label}
      aria-label={item.label}
      onClick={() => {
        onToolChange(item.id);
        setDrawingToolsOpen(false);
      }}
      onMouseDown={(e) => e.preventDefault()}
      className={`flex cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
        tool === item.id
          ? 'bg-[var(--accent)]/25 text-[var(--text-h)] ring-1 ring-[var(--accent)]'
          : 'text-slate-300 hover:bg-slate-700/60 hover:text-white'
      }`}
    >
      <span className={tool === item.id ? 'text-[var(--accent)]' : ''}>
        <svg {...COMMON_PROPS}>{item.icon}</svg>
      </span>
      {item.label}
    </button>
  );

  return (
    <div ref={rootRef}>
      <div className="absolute left-3 top-3 z-10 flex max-h-[calc(100%-1.5rem)] flex-col gap-2 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel)]/95 p-2 shadow-lg backdrop-blur">
        <div className="flex flex-col gap-1">
          {TOOL_BUTTONS.map(renderToolButton)}
          {renderPenButton()}
        </div>
        {showControls && (
          <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-2">
            {(noteContext || drawContext || shapeContext) && (
              <div className="grid grid-cols-2 gap-1">
                {NOTE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Farbe ${c}`}
                    title={
                      selectedElement
                        ? 'Farbe des ausgewählten Elements ändern'
                        : noteContext
                          ? 'Farbe für neue Notizen'
                          : 'Rahmen-/Strichfarbe'
                    }
                    onClick={() => handleColor(c)}
                    onMouseDown={(e) => e.preventDefault()}
                    style={{ backgroundColor: c }}
                    className={swatchButtonClass(activeColor === c)}
                  />
                ))}
              </div>
            )}
            {shapeContext && (
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  aria-label="Keine Füllung"
                  title={selectedElement ? 'Füllung entfernen' : 'Keine Füllung'}
                  onClick={() => handleFill(null)}
                  onMouseDown={(e) => e.preventDefault()}
                  className={`relative h-6 w-6 cursor-pointer select-none overflow-hidden rounded-full border-2 transition-transform ${
                    activeFill === NO_FILL
                      ? 'scale-110 border-white'
                      : 'border-slate-500 hover:scale-105'
                  }`}
                >
                  <span className="absolute inset-x-[-25%] top-1/2 h-0.5 -translate-y-1/2 rotate-45 bg-[var(--danger)]" />
                </button>
                {NOTE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Füllung ${c}`}
                    title={
                      selectedElement ? 'Füllung des Elements setzen' : 'Füllfarbe für neue Formen'
                    }
                    onClick={() => handleFill(c)}
                    onMouseDown={(e) => e.preventDefault()}
                    style={{ backgroundColor: c }}
                    className={swatchButtonClass(activeFill === c)}
                  />
                ))}
              </div>
            )}
            {(drawContext || shapeContext) && (
              <div className="flex items-center justify-between gap-1 px-0.5">
                {shapeContext && (
                  <button
                    type="button"
                    aria-label="Kein Rahmen"
                    title={
                      selectedElement && selectedType === 'shape'
                        ? 'Rahmen ausblenden'
                        : 'Ohne Rahmen zeichnen'
                    }
                    onClick={() => handleWidth(NO_BORDER)}
                    onMouseDown={(e) => e.preventDefault()}
                    className={`relative h-6 w-6 cursor-pointer select-none overflow-hidden rounded-md transition-colors ${
                      activeWidth === NO_BORDER
                        ? 'bg-[var(--danger)]/40 ring-1 ring-[var(--danger)]'
                        : 'hover:bg-slate-700/60'
                    }`}
                  >
                    <span className="absolute inset-x-[-25%] top-1/2 h-0.5 -translate-y-1/2 rotate-45 bg-current" />
                  </button>
                )}
                {STROKE_WIDTHS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    aria-label={`Strichstärke ${w}`}
                    title={`Strichstärke ${w}`}
                    onClick={() => handleWidth(w)}
                    onMouseDown={(e) => e.preventDefault()}
                    className={`flex h-6 w-6 cursor-pointer select-none items-center justify-center rounded-md transition-colors ${
                      activeWidth === w
                        ? 'bg-[var(--accent)]/30 ring-1 ring-[var(--accent)]'
                        : 'hover:bg-slate-700/60'
                    }`}
                  >
                    <span
                      className="rounded-full bg-current"
                      style={{
                        width: Math.min(18, w * 1.5),
                        height: Math.max(3, w * 0.75),
                      }}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {drawingToolsOpen && (
        <div className="absolute left-16 top-24 z-20 flex flex-col gap-1 rounded-xl border border-[var(--border)] bg-[var(--panel)]/95 p-2 shadow-lg backdrop-blur">
          <span className="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Zeichnen
          </span>
          {DRAWING_TOOLS.map(renderFlyoutItem)}
        </div>
      )}
    </div>
  );
}
