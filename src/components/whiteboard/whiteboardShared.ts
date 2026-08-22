import type {
  WhiteboardElement,
  WhiteboardPatch,
  WhiteboardShapeKind,
  WhiteboardTaskStatus,
} from '../../../shared/types';

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

// ---------------------------------------------------------------------------
// Layer (z) order
// ---------------------------------------------------------------------------

/**
 * Visual stacking comparator for non-arrow elements: by zIndex, ties broken
 * deterministically by creation time and id so legacy rows keep their order.
 */
export function compareStackOrder(a: WhiteboardElement, b: WhiteboardElement): number {
  return a.zIndex - b.zIndex || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

export type LayerDirection = 'forward' | 'backward';

/** One pending zIndex update produced by a layer move. */
export interface LayerPatch {
  id: string;
  patch: WhiteboardPatch;
}

/**
 * Computes the patches to move one element exactly one level forward or
 * backward in the stacking order. Arrows are excluded because they render
 * below all other elements anyway. Distinct neighbor values are swapped;
 * equal values (legacy rows) get a fresh adjacent value for the moved element.
 * Returns an empty array at the top/bottom edge of the stack.
 */
export function layerMovePatches(
  elements: WhiteboardElement[],
  id: string,
  direction: LayerDirection
): LayerPatch[] {
  const stack = elements.filter((e) => e.type !== 'arrow').sort(compareStackOrder);
  const index = stack.findIndex((e) => e.id === id);
  if (index === -1) return [];
  const neighborIndex = direction === 'forward' ? index + 1 : index - 1;
  const neighbor = stack[neighborIndex];
  if (!neighbor) return [];

  const me = stack[index];
  if (me.zIndex !== neighbor.zIndex) {
    return [
      { id: me.id, patch: { zIndex: neighbor.zIndex } },
      { id: neighbor.id, patch: { zIndex: me.zIndex } },
    ];
  }
  // Tied values would survive a swap, so the moved element gets a distinct
  // value just beyond the neighbor's (may dip below zero).
  const z = direction === 'forward' ? neighbor.zIndex + 1 : neighbor.zIndex - 1;
  return [{ id: me.id, patch: { zIndex: z } }];
}

/** Stacking value for newly created elements: always on top of the current stack. */
export function nextTopZIndex(elements: WhiteboardElement[]): number {
  let max = -1;
  for (const e of elements) {
    if (e.type !== 'arrow' && e.zIndex > max) max = e.zIndex;
  }
  return max + 1;
}
