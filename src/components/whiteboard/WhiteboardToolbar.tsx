import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { WhiteboardElement, WhiteboardPatch } from '../../../shared/types';
import { useI18n } from '../../hooks/useI18n';
import type { TranslationKey } from '../../i18n/messages';
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
  /** Default outline/note/text color for newly created elements. */
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

interface ToolButton {
  id: WhiteboardTool;
  labelKey: TranslationKey;
  icon: ReactNode;
}

const TOOL_BUTTONS: ToolButton[] = [
  {
    id: 'select',
    labelKey: 'whiteboard.toolbar.tools.select',
    icon: <path d="M4 3l7 17 2.5-6.5L20 11z" />,
  },
  {
    id: 'note',
    labelKey: 'whiteboard.toolbar.tools.note',
    icon: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M15 20v-5h5" />
      </>
    ),
  },
  {
    id: 'text',
    labelKey: 'whiteboard.toolbar.tools.text',
    icon: (
      <>
        <polyline points="4 7 4 4 20 4 20 7" />
        <line x1="12" y1="4" x2="12" y2="20" />
        <line x1="9" y1="20" x2="15" y2="20" />
      </>
    ),
  },
];

const DRAWING_TOOLS: ToolButton[] = [
  {
    id: 'draw',
    labelKey: 'whiteboard.toolbar.tools.draw',
    icon: <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />,
  },
  {
    id: 'rect',
    labelKey: 'whiteboard.toolbar.tools.rectangle',
    icon: <rect x="4" y="5" width="16" height="14" rx="1" />,
  },
  {
    id: 'ellipse',
    labelKey: 'whiteboard.toolbar.tools.ellipse',
    icon: <ellipse cx="12" cy="12" rx="9" ry="7" />,
  },
  {
    id: 'triangle',
    labelKey: 'whiteboard.toolbar.tools.triangle',
    icon: <polygon points="12,4 21,20 3,20" />,
  },
  {
    id: 'diamond',
    labelKey: 'whiteboard.toolbar.tools.diamond',
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

/** Labeled cluster for appearance controls. */
function ControlGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="px-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      {children}
    </div>
  );
}

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
  const { t, formatNumber } = useI18n();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const penButtonRef = useRef<HTMLButtonElement | null>(null);
  const flyoutRef = useRef<HTMLDivElement | null>(null);
  // The drawing tools live in a flyout attached to the pen button and are
  // not part of the always-visible toolbar column.
  const [drawingToolsOpen, setDrawingToolsOpen] = useState(false);
  const [flyoutPosition, setFlyoutPosition] = useState<{ left: number; top: number } | null>(null);
  const drawingActive = tool === 'draw' || isShapeTool(tool);
  // The flyout only exists while a drawing/shape tool is active; deriving the
  // visibility avoids a cascading reset effect on tool switches.
  const toolsOpen = drawingToolsOpen && drawingActive;

  // Clicks outside the toolbar close the flyout.
  useEffect(() => {
    if (!toolsOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!rootRef.current?.contains(target) && !flyoutRef.current?.contains(target)) {
        setDrawingToolsOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [toolsOpen]);

  // The flyout must escape the toolbar's scroll/clip container, so track the
  // pen button in viewport coordinates while it is open.
  useLayoutEffect(() => {
    if (!toolsOpen || !penButtonRef.current) {
      setFlyoutPosition(null);
      return;
    }

    const updatePosition = () => {
      const rect = penButtonRef.current?.getBoundingClientRect();
      if (rect) setFlyoutPosition({ left: rect.right + 6, top: rect.top });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [toolsOpen]);

  const selectedType = selectedElement?.type ?? null;
  // Which control clusters are relevant: driven either by the active tool
  // (defaults for new elements) or by the selected element (recoloring).
  const noteContext = tool === 'note' || selectedType === 'note';
  const textContext = tool === 'text' || selectedType === 'text';
  const drawContext = tool === 'draw' || selectedType === 'stroke';
  const shapeContext = isShapeTool(tool) || selectedType === 'shape';
  const showControls = noteContext || textContext || drawContext || shapeContext;

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

  const renderToolButton = (button: ToolButton) => {
    const label = t(button.labelKey);
    return (
      <button
        key={button.id}
        type="button"
        title={label}
        aria-label={label}
        onClick={() => onToolChange(button.id)}
        onMouseDown={(e) => e.preventDefault()}
        className={`flex h-9 w-9 cursor-pointer select-none items-center justify-center rounded-lg transition-colors ${
          tool === button.id
            ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
            : 'text-slate-300 hover:bg-slate-700/60 hover:text-white'
        }`}
      >
        <svg {...COMMON_PROPS}>{button.icon}</svg>
      </button>
    );
  };

  const swatchButtonClass = (active: boolean, outlined = false) =>
    `h-6 w-6 cursor-pointer select-none rounded-full border-2 transition-transform ${
      active
        ? 'scale-110 border-white'
        : outlined
          ? 'border-slate-500 hover:scale-105'
          : 'border-transparent hover:scale-105'
    }`;

  /** Color swatch grid; `titleFor` explains what the color applies to. */
  const renderColorGrid = (activeValue: string, onPick: (c: string) => void, titleFor: string) => (
    <div className="grid grid-cols-2 gap-1">
      {NOTE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`${titleFor} ${c}`}
          title={t(
            selectedElement
              ? 'whiteboard.toolbar.colors.changeSelected'
              : 'whiteboard.toolbar.colors.changeNew',
            { color: titleFor }
          )}
          onClick={() => onPick(c)}
          onMouseDown={(e) => e.preventDefault()}
          style={{ backgroundColor: c }}
          className={swatchButtonClass(activeValue === c)}
        />
      ))}
    </div>
  );

  /** Width pills; shapes additionally get the "no border" toggle. */
  const renderWidthRow = (withNoBorder: boolean) => (
    <div className="flex items-center justify-between gap-1 px-0.5 pt-0.5">
      {withNoBorder && (
        <button
          type="button"
          aria-label={t('whiteboard.toolbar.noBorder')}
          title={t(
            selectedElement && selectedType === 'shape'
              ? 'whiteboard.toolbar.hideBorder'
              : 'whiteboard.toolbar.drawWithoutBorder'
          )}
          onClick={() => handleWidth(NO_BORDER)}
          onMouseDown={(e) => e.preventDefault()}
          className={`relative h-6 w-6 cursor-pointer select-none overflow-hidden rounded-md transition-colors ${
            activeWidth === NO_BORDER
              ? 'bg-[var(--danger)]/40 ring-1 ring-[var(--danger)]'
              : 'text-slate-300 hover:bg-slate-700/60 hover:text-white'
          }`}
        >
          <span className="absolute inset-x-[-25%] top-1/2 h-0.5 -translate-y-1/2 rotate-45 bg-current" />
        </button>
      )}
      {STROKE_WIDTHS.map((w) => {
        const label = t('whiteboard.toolbar.strokeWidth', { width: formatNumber(w) });
        return (
          <button
            key={w}
            type="button"
            aria-label={label}
            title={label}
            onClick={() => handleWidth(w)}
            onMouseDown={(e) => e.preventDefault()}
            className={`flex h-6 w-6 cursor-pointer select-none items-center justify-center rounded-md text-slate-300 transition-colors ${
              activeWidth === w
                ? 'bg-[var(--accent)]/30 ring-1 ring-[var(--accent)]'
                : 'hover:bg-slate-700/60 hover:text-white'
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
        );
      })}
    </div>
  );

  const renderPenButton = () => (
    <button
      ref={penButtonRef}
      key="pen"
      type="button"
      title={t('whiteboard.toolbar.drawing')}
      aria-label={t('whiteboard.toolbar.drawing')}
      onClick={() => setDrawingToolsOpen((open) => !open)}
      onMouseDown={(e) => e.preventDefault()}
      className={`flex h-9 w-9 cursor-pointer select-none items-center justify-center rounded-lg transition-colors ${
        drawingActive
          ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
          : 'text-slate-300 hover:bg-slate-700/60 hover:text-white'
      }`}
    >
      <svg {...COMMON_PROPS}>
        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
      </svg>
    </button>
  );

  const renderFlyoutItem = (item: ToolButton) => {
    const label = t(item.labelKey);
    return (
      <button
        key={item.id}
        type="button"
        title={label}
        aria-label={label}
        onClick={() => {
          onToolChange(item.id);
          setDrawingToolsOpen(false);
        }}
        onMouseDown={(e) => e.preventDefault()}
        className={`flex cursor-pointer select-none items-center gap-2 whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
          tool === item.id
            ? 'bg-[var(--accent)]/25 text-[var(--text-h)] ring-1 ring-[var(--accent)]'
            : 'text-slate-300 hover:bg-slate-700/60 hover:text-white'
        }`}
      >
        <span className={tool === item.id ? 'text-[var(--accent)]' : ''}>
          <svg {...COMMON_PROPS}>{item.icon}</svg>
        </span>
        {label}
      </button>
    );
  };

  return (
    <div ref={rootRef}>
      {/* Main toolbar column. overflow-x-hidden prevents a stray horizontal
          scrollbar (and horizontally pannable/clipped content) when the
          vertical scrollbar squeezes the wide stroke-width row. */}
      <div className="absolute left-3 top-3 z-10 flex max-h-[calc(100%-1.5rem)] flex-col overflow-x-hidden overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel)]/95 p-2 shadow-lg backdrop-blur">
        <div className="flex flex-col gap-1">
          {TOOL_BUTTONS.map(renderToolButton)}
          {/* Relative wrapper anchors the drawing flyout to the pen button,
              so it always opens to the right of the panel edge no matter how
              wide the appearance controls make the panel. */}
          <div className="relative">{renderPenButton()}</div>
        </div>
        {/* Single scroll container: the outer panel already caps and scrolls
            the whole toolbar, so no nested scrollbar is needed here. */}
        {showControls && (
          <div className="mt-1 flex flex-col gap-3 border-t border-[var(--border)] pt-2">
            {shapeContext ? (
              <>
                <ControlGroup label={t('whiteboard.toolbar.groups.fill')}>
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      aria-label={t('whiteboard.toolbar.noFill')}
                      title={t(
                        selectedElement
                          ? 'whiteboard.toolbar.removeFill'
                          : 'whiteboard.toolbar.noFill'
                      )}
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
                        aria-label={`${t('whiteboard.toolbar.colors.fill')} ${c}`}
                        title={t(
                          selectedElement
                            ? 'whiteboard.toolbar.colors.setSelectedFill'
                            : 'whiteboard.toolbar.colors.setNewFill'
                        )}
                        onClick={() => handleFill(c)}
                        onMouseDown={(e) => e.preventDefault()}
                        style={{ backgroundColor: c }}
                        className={swatchButtonClass(activeFill === c)}
                      />
                    ))}
                  </div>
                </ControlGroup>
                <ControlGroup label={t('whiteboard.toolbar.groups.border')}>
                  {renderColorGrid(activeColor, handleColor, t('whiteboard.toolbar.colors.border'))}
                  {renderWidthRow(true)}
                </ControlGroup>
              </>
            ) : drawContext ? (
              <ControlGroup label={t('whiteboard.toolbar.groups.stroke')}>
                {renderColorGrid(activeColor, handleColor, t('whiteboard.toolbar.colors.stroke'))}
                {renderWidthRow(false)}
              </ControlGroup>
            ) : textContext ? (
              <ControlGroup label={t('whiteboard.toolbar.groups.text')}>
                {renderColorGrid(activeColor, handleColor, t('whiteboard.toolbar.colors.text'))}
              </ControlGroup>
            ) : (
              noteContext && (
                <ControlGroup label={t('whiteboard.toolbar.groups.background')}>
                  {renderColorGrid(
                    activeColor,
                    handleColor,
                    t('whiteboard.toolbar.colors.background')
                  )}
                </ControlGroup>
              )
            )}
          </div>
        )}
      </div>
      {toolsOpen &&
        flyoutPosition &&
        createPortal(
          <div
            ref={flyoutRef}
            style={{ left: flyoutPosition.left, top: flyoutPosition.top }}
            className="wb-flyout-in fixed z-20 flex flex-col gap-1 rounded-xl border border-[var(--border)] bg-[var(--panel)]/95 p-2 shadow-lg backdrop-blur"
          >
            <span className="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {t('whiteboard.toolbar.drawing')}
            </span>
            {DRAWING_TOOLS.map(renderFlyoutItem)}
            {/* Caret connecting the flyout to the pen button */}
            <span
              className="absolute -left-1 top-3 h-2 w-2 rotate-45 border-b border-l border-[var(--border)] bg-[var(--panel)]"
              aria-hidden
            />
          </div>,
          document.body
        )}
    </div>
  );
}
