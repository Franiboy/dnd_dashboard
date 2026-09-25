import type {
  WhiteboardElement,
  WhiteboardPatch,
  WhiteboardShapeKind,
  WhiteboardTaskStatus,
} from '../../../shared/types';
import type { TFunction } from '../../i18n/messages';

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
  'select' | 'note' | 'text' | 'draw' | 'rect' | 'ellipse' | 'triangle' | 'diamond';

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

/**
 * Outline width that hides a shape's border completely. Only valid for
 * shapes; freehand strokes are always kept visible by the server.
 */
export const NO_BORDER = 0;

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

export const TASK_STATUS_CLASS_NAMES: Record<WhiteboardTaskStatus, string> = {
  open: 'bg-slate-600 text-slate-100',
  in_progress: 'bg-[var(--warning)] text-slate-900',
  done: 'bg-[var(--accent)] text-[var(--accent-contrast)]',
};

const TASK_STATUS_LABEL_KEYS = {
  open: 'whiteboard.taskStatus.open',
  in_progress: 'whiteboard.taskStatus.inProgress',
  done: 'whiteboard.taskStatus.done',
} as const;

export function getTaskStatusLabel(status: WhiteboardTaskStatus, t: TFunction): string {
  return t(TASK_STATUS_LABEL_KEYS[status]);
}

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

// ---------------------------------------------------------------------------
// Board clipboard (system clipboard integration)
// ---------------------------------------------------------------------------

/**
 * Marker prefix for board element payloads written to the system clipboard.
 * Plain-text based so copy/paste also works across tabs and browsers that
 * restrict custom MIME types.
 */
export const WB_CLIPBOARD_PREFIX = 'dnd-dashboard:whiteboard:';

/**
 * Parses a system-clipboard text payload into board elements. Returns null
 * for anything that is not a marked, non-empty list of plausible element
 * objects; deeper validation happens server-side on create.
 */
export function parseBoardClipboard(payload: string): WhiteboardElement[] | null {
  if (!payload.startsWith(WB_CLIPBOARD_PREFIX)) return null;
  try {
    const parsed: unknown = JSON.parse(payload.slice(WB_CLIPBOARD_PREFIX.length));
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const elements = parsed.filter(
      (el): el is WhiteboardElement =>
        typeof el === 'object' &&
        el !== null &&
        typeof (el as WhiteboardElement).id === 'string' &&
        typeof (el as WhiteboardElement).type === 'string'
    );
    return elements.length > 0 ? elements : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Multi-selection
// ---------------------------------------------------------------------------

/** World-space bounding box around a set of elements. */
export interface SelectionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Bounding box spanning every element with one of the given ids. Arrows
 * contribute their two endpoints (x, y) and (x2, y2) instead of their box.
 * Returns null when no id matches an existing element.
 */
export function selectionBounds(
  elements: WhiteboardElement[],
  ids: readonly string[]
): SelectionBounds | null {
  const byId = new Map(elements.map((e) => [e.id, e]));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const e = byId.get(id);
    if (!e) continue;
    minX = Math.min(minX, e.x);
    minY = Math.min(minY, e.y);
    maxX = Math.max(maxX, e.x);
    maxY = Math.max(maxY, e.y);
    if (e.type === 'arrow') {
      minX = Math.min(minX, e.x2 ?? e.x);
      minY = Math.min(minY, e.y2 ?? e.y);
      maxX = Math.max(maxX, e.x2 ?? e.x);
      maxY = Math.max(maxY, e.y2 ?? e.y);
    } else {
      maxX = Math.max(maxX, e.x + e.width);
      maxY = Math.max(maxY, e.y + e.height);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** One pending update produced by a multi-selection layer move. */
export interface GroupLayerPatch {
  id: string;
  patch: WhiteboardPatch;
}

/**
 * Moves the whole selected block exactly one level forward or backward in the
 * stacking order while keeping the relative order inside the block intact.
 * Selected locked elements stay put and act as barriers; arrows are skipped
 * because they always render below everything. Computed against an in-memory
 * copy of the stack so every swap already sees the result of the previous one.
 */
export function groupLayerMovePatches(
  elements: WhiteboardElement[],
  ids: readonly string[],
  direction: LayerDirection
): GroupLayerPatch[] {
  const selected = new Set(ids);
  const stack = elements.filter((e) => e.type !== 'arrow').sort(compareStackOrder);
  const lockedIds = new Set(stack.filter((e) => e.locked).map((e) => e.id));
  const createdAtById = new Map(stack.map((e) => [e.id, e.createdAt]));

  // Live stacking order as mutable zIndex map so later swaps observe earlier
  // ones without intermediate renders.
  const order: { id: string; z: number }[] = stack.map((e) => ({ id: e.id, z: e.zIndex }));
  const restack = () =>
    order.sort(
      (a, b) =>
        a.z - b.z ||
        (createdAtById.get(a.id) ?? '').localeCompare(createdAtById.get(b.id) ?? '') ||
        a.id.localeCompare(b.id)
    );
  restack();

  // Topmost first for forward moves, bottom-most first for backward moves:
  // each swap vacates a slot that the next selected member then fills.
  const movers = order
    .filter(({ id }) => selected.has(id) && !lockedIds.has(id))
    .map((entry) => ({ ...entry }));
  if (direction === 'forward') movers.reverse();

  const patches: GroupLayerPatch[] = [];
  for (const mover of movers) {
    restack();
    const myIndex = order.findIndex((o) => o.id === mover.id);
    if (myIndex === -1) continue;
    const neighborIndex = direction === 'forward' ? myIndex + 1 : myIndex - 1;
    const neighbor = order[neighborIndex];
    // Selected members (including locked ones) belong to the block and must
    // never be crossed, otherwise the inner order would break apart.
    if (!neighbor || selected.has(neighbor.id)) continue;

    const mine = mover.z;
    // Capture before mutating: `neighbor` aliases an entry of `order`.
    const neighborZ = neighbor.z;
    if (mine === neighborZ) {
      // Tied values would survive a swap, so the mover gets a fresh adjacent
      // value beyond the neighbor (mirrors the single-element behavior).
      const z = direction === 'forward' ? neighborZ + 1 : neighborZ - 1;
      order[myIndex].z = z;
      mover.z = z;
      patches.push({ id: mover.id, patch: { zIndex: z } });
      continue;
    }
    order[myIndex].z = neighborZ;
    order[neighborIndex].z = mine;
    mover.z = neighborZ;
    patches.push({ id: mover.id, patch: { zIndex: neighborZ } });
    patches.push({ id: neighbor.id, patch: { zIndex: mine } });
  }
  return patches;
}
