import type { WhiteboardShapeKind, WhiteboardTaskStatus } from '../../../shared/types';

/** Image targets render as previews and must not open in a new tab. */
const BOARD_IMAGE_URL_RE = /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i;

export function isBoardImageUrl(url: string): boolean {
  return BOARD_IMAGE_URL_RE.test(url);
}

/**
 * Tools offered by the toolbar. Tasks, arrows and plain links are hidden
 * (legacy elements still render); pasted screenshots become image cards
 * internally without a dedicated tool. Each shape kind is its own tool so
 * the board can create the element directly from the active tool.
 */
export type WhiteboardTool =
  'select' | 'note' | 'draw' | 'rect' | 'ellipse' | 'triangle' | 'diamond';

const SHAPE_TOOLS: readonly WhiteboardTool[] = ['rect', 'ellipse', 'triangle', 'diamond'];

export function isShapeTool(tool: WhiteboardTool): boolean {
  return SHAPE_TOOLS.includes(tool);
}

/** Maps a shape tool onto the outline variant it places on the board. */
export function shapeKindForTool(tool: WhiteboardTool): WhiteboardShapeKind {
  return SHAPE_TOOLS.includes(tool) ? (tool as WhiteboardShapeKind) : 'rect';
}

/** Selectable outline widths in world units for shapes and strokes. */
export const STROKE_WIDTHS: readonly number[] = [3, 6, 12];

/** Sentinel for "no interior fill" on shape elements. */
export const NO_FILL = 'none';

export interface StrokeGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Points normalized to the bounding box (0..1 per axis). */
  points: [number, number][];
}

/**
 * Wraps raw world-space points into an element box. Boxes smaller than
 * `minSize` are expanded symmetrically around the center because the server
 * enforces a minimum element size.
 */
export function buildStrokeGeometry(
  points: { wx: number; wy: number }[],
  minSize = 60
): StrokeGeometry {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.wx);
    minY = Math.min(minY, p.wy);
    maxX = Math.max(maxX, p.wx);
    maxY = Math.max(maxY, p.wy);
  }
  let width = maxX - minX;
  let height = maxY - minY;
  if (width < minSize) {
    const cx = (minX + maxX) / 2;
    minX = cx - minSize / 2;
    width = minSize;
  }
  if (height < minSize) {
    const cy = (minY + maxY) / 2;
    minY = cy - minSize / 2;
    height = minSize;
  }
  const round = (v: number) => Math.round(v * 10000) / 10000;
  return {
    x: minX,
    y: minY,
    width,
    height,
    points: points.map((p) => [round((p.wx - minX) / width), round((p.wy - minY) / height)]),
  };
}

export const NOTE_COLORS: readonly string[] = [
  '#ffffff',
  '#facc15',
  '#fb923c',
  '#f87171',
  '#f472b6',
  '#a78bfa',
  '#60a5fa',
  '#34d399',
];

export const ARROW_COLOR = '#94a3b8';

export const TASK_STATUS_ORDER: readonly WhiteboardTaskStatus[] = ['open', 'in_progress', 'done'];

export const TASK_STATUS_META: Record<WhiteboardTaskStatus, { label: string; className: string }> =
  {
    open: { label: 'Offen', className: 'bg-slate-600 text-slate-100' },
    in_progress: { label: 'In Arbeit', className: 'bg-[var(--warning)] text-slate-900' },
    done: { label: 'Erledigt', className: 'bg-[var(--accent)] text-slate-900' },
  };

export function nextTaskStatus(status: WhiteboardTaskStatus): WhiteboardTaskStatus {
  const index = TASK_STATUS_ORDER.indexOf(status);
  return TASK_STATUS_ORDER[(index + 1) % TASK_STATUS_ORDER.length];
}
