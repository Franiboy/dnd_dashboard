import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { WHITEBOARD_DIVIDER_Y } from '../../../shared/types';
import type { SafeUser, WhiteboardElement, WhiteboardPatch } from '../../../shared/types';
import { WhiteboardElementView } from './WhiteboardElementView';
import { DockedNoteToolbar } from './NoteQuillEditor';
import {
  NO_FILL,
  buildStrokeGeometry,
  compareStackOrder,
  isBoardImageUrl,
  isShapeTool,
  layerMovePatches,
  nextTopZIndex,
  shapeKindForTool,
  type LayerDirection,
  type WhiteboardTool,
} from './whiteboardShared';
import {
  isUploadableImage,
  loadImageElement,
  probeImageSize,
  stripImageExtension,
  uploadWhiteboardImage,
} from './imageUpload';
import { useError } from '../../hooks/useError';

const MIN_SCALE = 0.33;
const MAX_SCALE = 20;
const BAND_EXTENT = 200_000;
const EMIT_INTERVAL_MS = 80;

const NOTE_DEFAULT_WIDTH = 220;
const NOTE_DEFAULT_HEIGHT = 160;
const SHAPE_DEFAULT_WIDTH = 200;
const SHAPE_DEFAULT_HEIGHT = 150;

/** Keeps created world sizes within the server-accepted range. */
function clampWorldSize(value: number): number {
  return Math.min(4000, Math.max(60, value));
}

interface Camera {
  x: number;
  y: number;
  scale: number;
}

type Gesture =
  | { kind: 'pan'; lastX: number; lastY: number }
  | { kind: 'create'; startWX: number; startWY: number }
  | {
      kind: 'draw';
      /** World-space points collected so far. */
      points: { wx: number; wy: number }[];
    }
  | { kind: 'band'; additive: boolean }
  | {
      kind: 'move';
      /** Dragged element (primary). */
      id: string;
      isArrow: boolean;
      grabDX: number;
      grabDY: number;
      downX: number;
      downY: number;
      /** Group members with base positions at gesture start. */
      group: {
        id: string;
        bx: number;
        by: number;
        bx2?: number | null;
        by2?: number | null;
      }[];
      lastEmit: number;
    }
  | {
      kind: 'resize';
      id: string;
      /** When set, height follows width to keep the image aspect ratio. */
      ratio: number | null;
      startW: number;
      startH: number;
      lastEmit: number;
    };

interface RectPreview {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface WhiteboardBoardProps {
  user: SafeUser;
  elements: WhiteboardElement[];
  tool: WhiteboardTool;
  color: string;
  /** Interior fill for new shapes; NO_FILL renders a transparent interior. */
  fillColor: string;
  /** Outline width in world units for new shapes and strokes. */
  strokeWidth: number;
  onToolChange: (tool: WhiteboardTool) => void;
  /** Reports the primary selected recolorable element (note/shape/stroke). */
  onSelectedElementId: (id: string | null) => void;
  createElement: (element: WhiteboardElement) => void;
  applyPatchLocal: (id: string, patch: WhiteboardPatch) => void;
  updateElement: (id: string, patch: WhiteboardPatch) => void;
  removeElement: (id: string) => void;
  beginLocalEdit: (id: string) => void;
  endLocalEdit: (id: string) => void;
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function zoneForWorldY(y: number): 'public' | 'private' {
  return y < WHITEBOARD_DIVIDER_Y ? 'public' : 'private';
}

function centerOf(element: WhiteboardElement): { x: number; y: number } {
  return { x: element.x + element.width / 2, y: element.y + element.height / 2 };
}

function resolveEndpoint(
  elementsById: Map<string, WhiteboardElement>,
  anchorId: string | null,
  fallbackX: number | null,
  fallbackY: number | null
): { x: number; y: number } {
  const anchored = anchorId ? elementsById.get(anchorId) : undefined;
  if (anchored) return centerOf(anchored);
  return { x: fallbackX ?? 0, y: fallbackY ?? 0 };
}

export function WhiteboardBoard({
  user,
  elements,
  tool,
  color,
  fillColor,
  strokeWidth,
  onToolChange,
  createElement,
  applyPatchLocal,
  updateElement,
  removeElement,
  beginLocalEdit,
  endLocalEdit,
  onSelectedElementId,
}: WhiteboardBoardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { showError } = useError();
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: 1 });
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const gestureRef = useRef<Gesture | null>(null);
  // Manual double-click tracking: element gestures deliberately avoid pointer
  // capture because it retargets native click/dblclick events away from the
  // element, so we detect two quick taps ourselves.
  const lastTapRef = useRef<{ id: string; x: number; y: number; t: number } | null>(null);
  const [rectPreview, setRectPreview] = useState<RectPreview | null>(null);
  // Live polyline of an in-progress freehand gesture.
  const [strokePreview, setStrokePreview] = useState<{ wx: number; wy: number }[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [croppingId, setCroppingId] = useState<string | null>(null);
  // Drives cursor feedback: open hand on hover comes from the elements
  // themselves; closed hand while panning or dragging an element.
  const [cursorMode, setCursorMode] = useState<'idle' | 'panning' | 'dragging'>('idle');
  const [uploadingCount, setUploadingCount] = useState(0);
  const lastMouseRef = useRef<{ x: number; y: number } | null>(null);

  // Window-level listeners keep drags alive outside the canvas bounds. They
  // delegate to the freshest closures via refs to avoid stale state.
  const windowMoveRef = useRef<((e: PointerEvent) => void) | null>(null);
  const windowUpRef = useRef<((e: PointerEvent) => void) | null>(null);

  const elementsById = useMemo(() => new Map(elements.map((e) => [e.id, e])), [elements]);

  // Visual stacking order (arrows render below everything and are excluded).
  const stackElements = useMemo(
    () => elements.filter((e) => e.type !== 'arrow').sort(compareStackOrder),
    [elements]
  );
  const stackIndexById = useMemo(
    () => new Map(stackElements.map((e, i) => [e.id, i])),
    [stackElements]
  );

  const setSelection = useCallback((ids: string | string[] | null, additive = false) => {
    setSelectedIds((prev) => {
      const incoming = ids === null ? [] : Array.isArray(ids) ? ids : [ids];
      if (incoming.length === 0) return additive ? prev : [];
      if (additive) {
        if (Array.isArray(ids)) return [...new Set([...prev, ...incoming])];
        return prev.includes(incoming[0])
          ? prev.filter((x) => x !== incoming[0])
          : [...prev, incoming[0]];
      }
      return incoming;
    });
  }, []);

  // Report the primary selected recolorable element to the toolbar palette.
  useEffect(() => {
    const recolorable = (type: WhiteboardElement['type']) =>
      type === 'note' || type === 'shape' || type === 'stroke';
    const primary = selectedIds.find((id) => {
      const element = elementsById.get(id);
      return !!element && recolorable(element.type);
    });
    onSelectedElementId(primary ?? null);
  }, [selectedIds, elementsById, onSelectedElementId]);

  const canEdit = useCallback(
    (element: WhiteboardElement) => element.zone === 'public' || element.ownerId === user.id,
    [user.id]
  );

  // Layer moves swap zIndex values with the adjacent stack neighbor; the
  // server sanitizes both patches and broadcasts them like any other update.
  const moveLayer = useCallback(
    (id: string, direction: LayerDirection) => {
      const target = elementsById.get(id);
      if (!target || !canEdit(target) || target.locked) return;
      for (const { id: patchId, patch } of layerMovePatches(elements, id, direction)) {
        updateElement(patchId, patch);
      }
    },
    [elements, elementsById, canEdit, updateElement]
  );

  // Center the initial view around the zone divider.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setCamera({ x: rect.width / 2 - 200, y: rect.height * 0.4, scale: 1 });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const bounds = el.getBoundingClientRect();
      const cx = e.clientX - bounds.left;
      const cy = e.clientY - bounds.top;
      setCamera((cam) => {
        const factor = Math.exp(-e.deltaY * 0.0015);
        const scale = clampScale(cam.scale * factor);
        const k = scale / cam.scale;
        return { scale, x: cx - (cx - cam.x) * k, y: cy - (cy - cam.y) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (e.key === 'Escape') {
        setEditingId(null);
        setSelectedIds([]);
        if (tool !== 'select') onToolChange('select');
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !inField && selectedIds.length > 0) {
        for (const id of selectedIds) {
          const element = elementsById.get(id);
          if (element && canEdit(element) && !element.locked) removeElement(id);
        }
        setSelectedIds([]);
      }
      if (!inField && selectedIds.length === 1 && (e.key === '[' || e.key === ']')) {
        e.preventDefault();
        moveLayer(selectedIds[0], e.key === ']' ? 'forward' : 'backward');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [elementsById, selectedIds, tool, onToolChange, removeElement, canEdit, moveLayer]);

  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return { wx: 0, wy: 0 };
    const bounds = el.getBoundingClientRect();
    const cam = cameraRef.current;
    return {
      wx: (clientX - bounds.left - cam.x) / cam.scale,
      wy: (clientY - bounds.top - cam.y) / cam.scale,
    };
  }, []);

  const finishCreate = useCallback(
    (gesture: Extract<Gesture, { kind: 'create' }>, wx: number, wy: number) => {
      if (tool !== 'note' && !isShapeTool(tool)) return;
      const now = new Date().toISOString();
      const isShape = isShapeTool(tool);

      let width = Math.abs(wx - gesture.startWX);
      let height = Math.abs(wy - gesture.startWY);
      let px = Math.min(gesture.startWX, wx);
      let py = Math.min(gesture.startWY, wy);
      if (width < 40 || height < 40) {
        // Respect the current zoom: keep a constant on-screen footprint.
        const s = cameraRef.current.scale;
        width = clampWorldSize((isShape ? SHAPE_DEFAULT_WIDTH : NOTE_DEFAULT_WIDTH) / s);
        height = clampWorldSize((isShape ? SHAPE_DEFAULT_HEIGHT : NOTE_DEFAULT_HEIGHT) / s);
        px = gesture.startWX - width / 2;
        py = gesture.startWY - height / 2;
      }
      const id = crypto.randomUUID();
      createElement({
        id,
        type: isShape ? 'shape' : 'note',
        zone: zoneForWorldY(py + height / 2),
        ownerId: user.id,
        ownerName: user.displayName,
        x: px,
        y: py,
        x2: null,
        y2: null,
        width,
        height,
        color,
        text: '',
        description: null,
        status: null,
        url: null,
        fromId: null,
        toId: null,
        shapeKind: isShape ? shapeKindForTool(tool) : null,
        fillColor: isShape && fillColor !== NO_FILL ? fillColor : null,
        strokeWidth,
        points: null,
        zIndex: nextTopZIndex(elements),
        locked: false,
        createdAt: now,
        updatedAt: now,
      });
      setSelection([id]);
      onToolChange('select');
    },
    [
      tool,
      color,
      fillColor,
      strokeWidth,
      elements,
      user.id,
      user.displayName,
      createElement,
      onToolChange,
      setSelection,
    ]
  );

  const finishDraw = useCallback(
    (points: { wx: number; wy: number }[]) => {
      // A single tap still leaves a round ink dot.
      const pts =
        points.length === 1 ? [points[0], { wx: points[0].wx + 0.01, wy: points[0].wy }] : points;
      const geometry = buildStrokeGeometry(pts);
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      createElement({
        id,
        type: 'stroke',
        zone: zoneForWorldY(geometry.y + geometry.height / 2),
        ownerId: user.id,
        ownerName: user.displayName,
        x: geometry.x,
        y: geometry.y,
        x2: null,
        y2: null,
        width: geometry.width,
        height: geometry.height,
        color,
        text: '',
        description: null,
        status: null,
        url: null,
        fromId: null,
        toId: null,
        shapeKind: null,
        fillColor: null,
        // Freehand ink is never invisible, even if "no border" (0) is still
        // selected as the shape default.
        strokeWidth: Math.max(1, strokeWidth),
        points: geometry.points,
        zIndex: nextTopZIndex(elements),
        locked: false,
        createdAt: now,
        updatedAt: now,
      });
      // Deliberately no auto-selection: the pen stays active so further
      // strokes can be drawn straight over the fresh one.
    },
    [color, strokeWidth, elements, user.id, user.displayName, createElement]
  );

  const runGestureMove = (clientX: number, clientY: number) => {
    const g = gestureRef.current;
    if (!g) return;

    if (g.kind === 'pan') {
      const dx = clientX - g.lastX;
      const dy = clientY - g.lastY;
      g.lastX = clientX;
      g.lastY = clientY;
      setCamera((cam) => ({ ...cam, x: cam.x + dx, y: cam.y + dy }));
      return;
    }

    const { wx, wy } = screenToWorld(clientX, clientY);

    if (g.kind === 'draw') {
      // Skip micro-movements to keep the stored point list small.
      const last = g.points[g.points.length - 1];
      if (Math.hypot(wx - last.wx, wy - last.wy) < 2 / cameraRef.current.scale) return;
      if (g.points.length >= 4000) return;
      g.points.push({ wx, wy });
      setStrokePreview([...g.points]);
      return;
    }

    if (g.kind === 'create' || g.kind === 'band') {
      setRectPreview((prev) => (prev ? { ...prev, x2: wx, y2: wy } : prev));
      return;
    }

    if (g.kind === 'move') {
      const draggedBase = g.group.find((m) => m.id === g.id);
      const deltaX = wx - g.grabDX - (draggedBase?.bx ?? 0);
      const deltaY = wy - g.grabDY - (draggedBase?.by ?? 0);
      const shouldEmit = performance.now() - g.lastEmit > EMIT_INTERVAL_MS;
      if (shouldEmit) g.lastEmit = performance.now();

      for (const member of g.group) {
        const el = elementsById.get(member.id);
        if (!el || !canEdit(el) || el.locked) continue;
        const nx = member.bx + deltaX;
        const ny = member.by + deltaY;
        if (el.type === 'arrow') {
          applyPatchLocal(member.id, {
            x: nx,
            y: ny,
            x2: (member.bx2 ?? el.x2 ?? 0) + deltaX,
            y2: (member.by2 ?? el.y2 ?? 0) + deltaY,
          });
          if (shouldEmit) {
            updateElement(member.id, {
              x: nx,
              y: ny,
              x2: (member.bx2 ?? el.x2 ?? 0) + deltaX,
              y2: (member.by2 ?? el.y2 ?? 0) + deltaY,
            });
          }
          continue;
        }
        applyPatchLocal(member.id, { x: nx, y: ny });
        if (shouldEmit) updateElement(member.id, { x: nx, y: ny });
      }
      return;
    }

    if (g.kind === 'resize') {
      const el = elementsById.get(g.id);
      if (!el) return;
      const nw = Math.max(80, wx - el.x);
      const nh = g.ratio ? Math.max(60, nw / g.ratio) : Math.max(60, wy - el.y);
      applyPatchLocal(g.id, { width: nw, height: nh });
      if (performance.now() - g.lastEmit > EMIT_INTERVAL_MS) {
        g.lastEmit = performance.now();
        updateElement(g.id, { width: nw, height: nh });
      }
    }
  };

  const finishGestureCore = (clientX: number, clientY: number) => {
    const g = gestureRef.current;
    gestureRef.current = null;
    unbindWindowGesture();
    setCursorMode('idle');
    if (!g) return;

    if (g.kind === 'create') {
      const { wx, wy } = screenToWorld(clientX, clientY);
      finishCreate(g, wx, wy);
      setRectPreview(null);
      return;
    }
    if (g.kind === 'draw') {
      finishDraw(g.points);
      setStrokePreview(null);
      return;
    }
    if (g.kind === 'band') {
      // Select every non-arrow element intersecting the rubber band.
      if (rectPreview) {
        const rx1 = Math.min(rectPreview.x1, rectPreview.x2);
        const ry1 = Math.min(rectPreview.y1, rectPreview.y2);
        const rx2 = Math.max(rectPreview.x1, rectPreview.x2);
        const ry2 = Math.max(rectPreview.y1, rectPreview.y2);
        const hits = elements
          .filter(
            (e) =>
              e.type !== 'arrow' &&
              e.x < rx2 &&
              e.x + e.width > rx1 &&
              e.y < ry2 &&
              e.y + e.height > ry1
          )
          .map((e) => e.id);
        setSelectedIds((prev) => (g.additive ? [...new Set([...prev, ...hits])] : hits));
      }
      setRectPreview(null);
      return;
    }
    if (g.kind === 'move') {
      for (const member of g.group) {
        const el = elementsById.get(member.id);
        if (!el || !canEdit(el)) continue;
        const patch: WhiteboardPatch = { x: el.x, y: el.y };
        if (el.type === 'arrow') {
          patch.x2 = el.x2;
          patch.y2 = el.y2;
        } else {
          // Crossing the divider on drop switches the zone server-side.
          patch.zone = zoneForWorldY(el.y + el.height / 2);
        }
        updateElement(el.id, patch);
      }

      // A single link card opens its URL on click (image cards stay put).
      if (g.group.length === 1) {
        const el = elementsById.get(g.id);
        const moved = Math.hypot(clientX - g.downX, clientY - g.downY);
        if (el && el.type === 'link' && el.url && !isBoardImageUrl(el.url) && moved < 5) {
          window.open(el.url, '_blank', 'noopener,noreferrer');
        }
      }
      for (const member of g.group) endLocalEdit(member.id);
      return;
    }
    if (g.kind === 'resize') {
      const el = elementsById.get(g.id);
      if (el) updateElement(el.id, { width: el.width, height: el.height });
      endLocalEdit(g.id);
    }
  };

  // Latest-closure refs so window listeners never work with stale state.
  const latestMoveRef = useRef(runGestureMove);
  latestMoveRef.current = runGestureMove;
  const latestFinishRef = useRef(finishGestureCore);
  latestFinishRef.current = finishGestureCore;

  function bindWindowGesture() {
    if (windowMoveRef.current) return;
    const move = (e: PointerEvent) => latestMoveRef.current(e.clientX, e.clientY);
    const up = (e: PointerEvent) => latestFinishRef.current(e.clientX, e.clientY);
    windowMoveRef.current = move;
    windowUpRef.current = up;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function unbindWindowGesture() {
    const move = windowMoveRef.current;
    const up = windowUpRef.current;
    if (!move || !up) return;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    windowMoveRef.current = null;
    windowUpRef.current = null;
  }

  const addImageFile = useCallback(
    async (file: File, worldPoint: { x: number; y: number }) => {
      if (!isUploadableImage(file)) {
        showError('Nur PNG, JPEG, GIF oder WebP bis 8 MB.');
        return;
      }
      setUploadingCount((n) => n + 1);
      try {
        const url = await uploadWhiteboardImage(file);
        const dims = await probeImageSize(url);
        // Keep a constant on-screen footprint regardless of zoom.
        const s = cameraRef.current.scale;
        const width = clampWorldSize((dims ? 360 : 260) / s);
        const height = clampWorldSize(dims ? (dims.h / dims.w) * width : 130 / s);
        const now = new Date().toISOString();
        const id = crypto.randomUUID();
        createElement({
          id,
          type: 'link',
          zone: zoneForWorldY(worldPoint.y),
          ownerId: user.id,
          ownerName: user.displayName,
          x: Math.round(worldPoint.x - width / 2),
          y: Math.round(worldPoint.y - height / 2),
          x2: null,
          y2: null,
          width,
          height,
          color: '#60a5fa',
          text: stripImageExtension(file.name || 'Screenshot'),
          description: null,
          status: null,
          url,
          fromId: null,
          toId: null,
          shapeKind: null,
          fillColor: null,
          strokeWidth: 3,
          points: null,
          zIndex: nextTopZIndex(elements),
          locked: false,
          createdAt: now,
          updatedAt: now,
        });
        setSelection([id]);
      } catch (err) {
        showError(err instanceof Error ? err.message : 'Upload fehlgeschlagen.');
      } finally {
        setUploadingCount((n) => n - 1);
      }
    },
    [user.id, user.displayName, cameraRef, elements, createElement, showError, setSelection]
  );

  // Ctrl+V pastes screenshots/images from the clipboard onto the board.
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter(isUploadableImage);
      if (files.length === 0) return;
      e.preventDefault();
      const el = containerRef.current;
      const fallback = el
        ? { x: el.clientWidth / 2, y: el.clientHeight / 3 }
        : { x: 0, y: WHITEBOARD_DIVIDER_Y - 200 };
      for (const file of files) {
        const at = lastMouseRef.current
          ? screenToWorld(lastMouseRef.current.x, lastMouseRef.current.y)
          : screenToWorld(fallback.x, fallback.y);
        await addImageFile(file, { x: at.wx, y: at.wy });
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addImageFile, screenToWorld]);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (editingId) return;
    if (croppingId) {
      // Clicking outside the crop frame cancels cropping.
      setCroppingId(null);
      return;
    }
    // Right/middle button always pans the canvas, no matter which tool is
    // active; left stays reserved for selecting, drawing and creating.
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      gestureRef.current = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
      bindWindowGesture();
      setCursorMode('panning');
      return;
    }
    if (e.button !== 0) return;
    const { wx, wy } = screenToWorld(e.clientX, e.clientY);

    // Touch/pen pointers have no right button, so they keep one-finger
    // panning in every tool instead of accidentally creating or drawing.
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      if (tool === 'select') setSelection(null);
      gestureRef.current = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
      bindWindowGesture();
      setCursorMode('panning');
      return;
    }

    if (tool === 'select') {
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      // Any empty-canvas drag draws a rubber-band selection; Shift/Ctrl keeps
      // the current selection while banding. A plain click still drops the
      // selection immediately and via the empty band on release.
      if (!additive) setSelection(null);
      gestureRef.current = { kind: 'band', additive };
      setRectPreview({ x1: wx, y1: wy, x2: wx, y2: wy });
      bindWindowGesture();
      return;
    }
    if (tool === 'draw') {
      // A finished stroke remains unselected; clear any previous selection so
      // follow-up delete or appearance actions cannot target an old element.
      setSelection(null);
      // Freehand: collect world points until the gesture ends.
      gestureRef.current = { kind: 'draw', points: [{ wx, wy }] };
      setStrokePreview([{ wx, wy }]);
      bindWindowGesture();
      return;
    }
    gestureRef.current = {
      kind: 'create',
      startWX: wx,
      startWY: wy,
    };
    setRectPreview({ x1: wx, y1: wy, x2: wx, y2: wy });
    bindWindowGesture();
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    runGestureMove(e.clientX, e.clientY);
  };

  const finishGesture = (e: ReactPointerEvent<HTMLDivElement>) => {
    finishGestureCore(e.clientX, e.clientY);
  };

  const startElementDrag = (event: ReactPointerEvent, element: WhiteboardElement) => {
    // Right/middle presses fall through to the board background, which turns
    // them into a pan gesture regardless of the active tool.
    if (event.button !== 0) return;
    // Touch/pen pointers pan the board instead of moving an element.
    if (event.pointerType === 'touch' || event.pointerType === 'pen') return;
    event.stopPropagation();
    if (croppingId) return;

    // Shift/Ctrl+click toggles membership in the multi-selection.
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      setSelection(element.id, true);
      return;
    }

    setSelectedIds((prev) => (prev.includes(element.id) ? prev : [element.id]));
    if (!canEdit(element)) return;

    const now = performance.now();
    const last = lastTapRef.current;
    lastTapRef.current = { id: element.id, x: event.clientX, y: event.clientY, t: now };
    if (
      last &&
      last.id === element.id &&
      now - last.t < 600 &&
      Math.hypot(event.clientX - last.x, event.clientY - last.y) < 8
    ) {
      lastTapRef.current = null;
      // Suppress the browser defaults of this press (focus shift to body,
      // text selection) so the freshly focused editor keeps its focus.
      event.preventDefault();
      openEdit(element.id);
      return;
    }

    // Locked elements stay selectable and editable but cannot be moved;
    // dragging them pans the canvas exactly like the background does.
    bindWindowGesture();
    if (element.locked) {
      setCursorMode('panning');
      gestureRef.current = { kind: 'pan', lastX: event.clientX, lastY: event.clientY };
      return;
    }

    // Assemble the moving group from the current multi-selection.
    const groupIds =
      selectedIds.length > 1 && selectedIds.includes(element.id) ? [...selectedIds] : [element.id];
    const group = groupIds
      .map((id) => ({ id, el: elementsById.get(id) }))
      .filter(({ el }) => el && canEdit(el) && !el.locked)
      .map(({ id, el }) => ({
        id,
        bx: el!.x,
        by: el!.y,
        bx2: el!.type === 'arrow' ? el!.x2 : null,
        by2: el!.type === 'arrow' ? el!.y2 : null,
      }));
    if (!group.some((m) => m.id === element.id)) {
      group.push({
        id: element.id,
        bx: element.x,
        by: element.y,
        bx2: element.type === 'arrow' ? element.x2 : null,
        by2: element.type === 'arrow' ? element.y2 : null,
      });
    }

    setCursorMode('dragging');
    const { wx, wy } = screenToWorld(event.clientX, event.clientY);
    gestureRef.current = {
      kind: 'move',
      id: element.id,
      isArrow: false,
      grabDX: wx - element.x,
      grabDY: wy - element.y,
      downX: event.clientX,
      downY: event.clientY,
      group,
      lastEmit: performance.now(),
    };
    for (const member of group) beginLocalEdit(member.id);
  };

  const startElementResize = (event: ReactPointerEvent, element: WhiteboardElement) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (!canEdit(element) || element.locked) return;
    bindWindowGesture();
    setCursorMode('dragging');
    gestureRef.current = {
      kind: 'resize',
      id: element.id,
      // Images keep their aspect ratio while scaling.
      ratio: isBoardImageUrl(element.url ?? '')
        ? element.width / Math.max(1, element.height)
        : null,
      startW: element.width,
      startH: element.height,
      lastEmit: performance.now(),
    };
    beginLocalEdit(element.id);
  };

  const startArrowDrag = (event: ReactPointerEvent, element: WhiteboardElement) => {
    // Right/middle presses fall through to the board background pan.
    if (event.button !== 0) return;
    event.stopPropagation();
    if (!canEdit(element)) return;
    bindWindowGesture();
    setCursorMode('dragging');
    const { wx, wy } = screenToWorld(event.clientX, event.clientY);
    gestureRef.current = {
      kind: 'move',
      id: element.id,
      isArrow: true,
      grabDX: wx - element.x,
      grabDY: wy - element.y,
      downX: event.clientX,
      downY: event.clientY,
      group: [
        {
          id: element.id,
          bx: element.x,
          by: element.y,
          bx2: element.x2,
          by2: element.y2,
        },
      ],
      lastEmit: performance.now(),
    };
    beginLocalEdit(element.id);
    setSelection([element.id]);
  };

  const openEdit = useCallback(
    (id: string) => {
      // Callers verify existence/permissions; the freshly created element
      // from createNoteAt is intentionally not required to be in the map yet.
      setEditingId(id);
      beginLocalEdit(id);
    },
    [beginLocalEdit]
  );

  const closeEdit = useCallback(() => {
    setEditingId((current) => {
      if (current) endLocalEdit(current);
      return null;
    });
  }, [endLocalEdit]);

  // Double-click on empty canvas spawns a note in the last used color,
  // already focused for typing.
  const createNoteAt = useCallback(
    (clientX: number, clientY: number) => {
      const { wx, wy } = screenToWorld(clientX, clientY);
      const s = cameraRef.current.scale;
      const width = clampWorldSize(NOTE_DEFAULT_WIDTH / s);
      const height = clampWorldSize(NOTE_DEFAULT_HEIGHT / s);
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      createElement({
        id,
        type: 'note',
        zone: zoneForWorldY(wy),
        ownerId: user.id,
        ownerName: user.displayName,
        x: wx - width / 2,
        y: wy - height / 2,
        x2: null,
        y2: null,
        width,
        height,
        color,
        text: '',
        description: null,
        status: null,
        url: null,
        fromId: null,
        toId: null,
        shapeKind: null,
        fillColor: null,
        strokeWidth: 3,
        points: null,
        zIndex: nextTopZIndex(elements),
        locked: false,
        createdAt: now,
        updatedAt: now,
      });
      setSelection([id]);
      openEdit(id);
    },
    [
      screenToWorld,
      color,
      user.id,
      user.displayName,
      elements,
      createElement,
      openEdit,
      setSelection,
    ]
  );

  const requestElementInteraction = useCallback(
    (id: string) => {
      const element = elementsById.get(id);
      if (!element || !canEdit(element)) return;
      // Shapes and strokes have no editor: selecting is all the interaction.
      if (element.type === 'shape' || element.type === 'stroke') {
        setSelection([id]);
        return;
      }
      // Images get a crop tool instead of a text editor.
      if (element.type === 'link' && isBoardImageUrl(element.url ?? '')) {
        setSelection([id]);
        setCroppingId(id);
        return;
      }
      setSelection([id]);
      openEdit(id);
    },
    [elementsById, canEdit, openEdit, setSelection]
  );

  const handleCropApply = useCallback(
    async (id: string, crop: { x: number; y: number; w: number; h: number }) => {
      const element = elementsById.get(id);
      if (!element?.url) return;
      setUploadingCount((n) => n + 1);
      try {
        const img = await loadImageElement(element.url);
        if (!img) throw new Error('Bild konnte nicht geladen werden.');
        const sw = Math.max(1, Math.round(crop.w * img.naturalWidth));
        const sh = Math.max(1, Math.round(crop.h * img.naturalHeight));
        const sx = Math.round(crop.x * img.naturalWidth);
        const sy = Math.round(crop.y * img.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Zuschneiden nicht unterstützt.');
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/png')
        );
        if (!blob) throw new Error('Zuschneiden fehlgeschlagen.');
        const url = await uploadWhiteboardImage(
          new File([blob], 'crop.png', { type: 'image/png' })
        );
        updateElement(id, {
          url,
          width: Math.max(80, Math.round(crop.w * element.width)),
          height: Math.max(60, Math.round(crop.h * element.height)),
        });
      } catch (err) {
        showError(err instanceof Error ? err.message : 'Zuschneiden fehlgeschlagen.');
      } finally {
        setUploadingCount((n) => n - 1);
        setCroppingId(null);
      }
    },
    [elementsById, updateElement, showError]
  );

  const dividerScreenY = camera.y + WHITEBOARD_DIVIDER_Y * camera.scale;
  const centerWorldY =
    containerRef.current && containerRef.current.clientHeight > 0
      ? (containerRef.current.clientHeight / 2 - camera.y) / camera.scale
      : WHITEBOARD_DIVIDER_Y;
  const centerZone = zoneForWorldY(centerWorldY);

  const arrows = elements.filter((e) => e.type === 'arrow');

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
      style={{
        touchAction: 'none',
        cursor: tool !== 'select' ? 'crosshair' : cursorMode === 'idle' ? 'default' : 'grabbing',
        backgroundImage: 'radial-gradient(circle, rgba(148,163,184,0.22) 1px, transparent 1px)',
        backgroundSize: `${28 * camera.scale}px ${28 * camera.scale}px`,
        backgroundPosition: `${camera.x}px ${camera.y}px`,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishGesture}
      onPointerCancel={finishGesture}
      onContextMenu={(e) => e.preventDefault()}
      onDoubleClick={(e) => {
        if (tool !== 'select' || editingId || croppingId) return;
        if ((e.target as HTMLElement).closest('[data-whiteboard-element]')) return;
        createNoteAt(e.clientX, e.clientY);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer?.files ?? []).filter(isUploadableImage);
        for (const file of files) {
          const at = screenToWorld(e.clientX, e.clientY);
          void addImageFile(file, { x: at.wx, y: at.wy });
        }
      }}
    >
      <div
        className="absolute left-0 top-0 h-0 w-0"
        style={{
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
          transformOrigin: '0 0',
          // Promote to its own GPU layer only during pointer gestures. While
          // idle (e.g. right after wheel zoom) the layer must stay unpromoted,
          // otherwise Chromium keeps scaling the stale rasterized texture and
          // text stays blurry until some other repaint happens.
          willChange: cursorMode === 'idle' ? 'auto' : 'transform',
        }}
      >
        <div
          className="pointer-events-none absolute border-b-2 border-[var(--accent)]/50 bg-[var(--accent)]/5"
          style={{
            left: -BAND_EXTENT,
            top: -BAND_EXTENT,
            width: BAND_EXTENT * 2,
            height: BAND_EXTENT,
          }}
        />

        <svg
          className="pointer-events-none absolute overflow-visible"
          style={{ left: 0, top: 0 }}
          width={1}
          height={1}
        >
          {arrows.map((arrow) => {
            const start = resolveEndpoint(elementsById, arrow.fromId, arrow.x, arrow.y);
            const end = resolveEndpoint(elementsById, arrow.toId, arrow.x2, arrow.y2);
            const angle = Math.atan2(end.y - start.y, end.x - start.x);
            const headLen = 14;
            const spread = Math.PI / 7;
            const head = [
              `${end.x},${end.y}`,
              `${end.x - headLen * Math.cos(angle - spread)},${
                end.y - headLen * Math.sin(angle - spread)
              }`,
              `${end.x - headLen * Math.cos(angle + spread)},${
                end.y - headLen * Math.sin(angle + spread)
              }`,
            ].join(' ');
            const selected = selectedIds.includes(arrow.id);
            return (
              <g key={arrow.id}>
                <line
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  stroke={selected ? 'var(--accent)' : arrow.color}
                  strokeWidth={selected ? 4 : 3}
                  strokeLinecap="round"
                />
                <polygon points={head} fill={selected ? 'var(--accent)' : arrow.color} />
                <line
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  stroke="transparent"
                  strokeWidth={18}
                  style={{
                    pointerEvents: 'stroke',
                    cursor: selected && cursorMode === 'dragging' ? 'grabbing' : 'grab',
                  }}
                  onPointerDown={(e) => startArrowDrag(e, arrow)}
                />
              </g>
            );
          })}
        </svg>

        {rectPreview &&
          (() => {
            const x = Math.min(rectPreview.x1, rectPreview.x2);
            const y = Math.min(rectPreview.y1, rectPreview.y2);
            return (
              <div
                className="pointer-events-none absolute rounded-lg border-2 border-dashed border-[var(--accent)] bg-[var(--accent)]/10"
                style={{
                  left: x,
                  top: y,
                  width: Math.abs(rectPreview.x2 - rectPreview.x1),
                  height: Math.abs(rectPreview.y2 - rectPreview.y1),
                }}
              />
            );
          })()}

        {strokePreview && (
          <svg
            className="pointer-events-none absolute overflow-visible"
            style={{ left: 0, top: 0 }}
            width={1}
            height={1}
          >
            <polyline
              points={strokePreview.map((p) => `${p.wx},${p.wy}`).join(' ')}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}

        {stackElements.map((element) => {
          const stackIndex = stackIndexById.get(element.id) ?? 0;
          return (
            <WhiteboardElementView
              key={element.id}
              element={element}
              selected={selectedIds.includes(element.id) && !editingId}
              editing={editingId === element.id}
              dragging={cursorMode === 'dragging'}
              cropping={croppingId === element.id}
              cameraScale={camera.scale}
              onPointerDown={startElementDrag}
              onStartResize={startElementResize}
              onRequestEdit={requestElementInteraction}
              onCloseEdit={closeEdit}
              onCropApply={(crop) => {
                if (croppingId) void handleCropApply(croppingId, crop);
              }}
              onCropCancel={() => setCroppingId(null)}
              onUpdate={(id, patch) => updateElement(id, patch)}
              onDelete={(id) => {
                removeElement(id);
                setSelectedIds((prev) => prev.filter((x) => x !== id));
              }}
              canBringForward={stackIndex < stackElements.length - 1}
              canSendBackward={stackIndex > 0}
              onBringForward={(id) => moveLayer(id, 'forward')}
              onSendBackward={(id) => moveLayer(id, 'backward')}
            />
          );
        })}
      </div>

      <DockedNoteToolbar visible={!!editingId && elementsById.get(editingId)?.type === 'note'} />

      <div
        className="pointer-events-none absolute inset-x-0 select-none border-t-2 border-dashed border-[var(--accent)]/60"
        style={{ top: dividerScreenY }}
      >
        <span
          className="absolute right-3 -translate-y-full rounded-md bg-[var(--panel)]/90 px-2 py-0.5 text-xs font-semibold text-[var(--accent)] shadow"
          style={{ top: '-2px' }}
        >
          Öffentlich – alle sehen & bearbeiten
        </span>
        <span
          className="absolute right-3 rounded-md bg-[var(--panel)]/90 px-2 py-0.5 text-xs font-medium text-slate-300 shadow"
          style={{ top: '6px' }}
        >
          Privat – nur deine Elemente ({user.displayName})
        </span>
      </div>

      <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full border border-[var(--border)] bg-[var(--panel)]/95 px-4 py-1 text-xs font-medium shadow backdrop-blur">
        {centerZone === 'public'
          ? 'Neue Elemente hier sind Öffentlich'
          : 'Neue Elemente hier sind Privat'}
      </div>

      <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--panel)]/95 p-1 shadow backdrop-blur">
        <button
          type="button"
          title="Herauszoomen"
          onClick={() =>
            setCamera((cam) => {
              const scale = clampScale(cam.scale / 1.25);
              const k = scale / cam.scale;
              return {
                scale,
                x:
                  containerRef.current!.clientWidth / 2 -
                  (containerRef.current!.clientWidth / 2 - cam.x) * k,
                y:
                  containerRef.current!.clientHeight / 2 -
                  (containerRef.current!.clientHeight / 2 - cam.y) * k,
              };
            })
          }
          className="h-8 w-8 rounded-md text-slate-200 hover:bg-slate-700"
        >
          −
        </button>
        <button
          type="button"
          title="Ansicht zurücksetzen"
          onClick={() => {
            const el = containerRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            setCamera({ x: rect.width / 2 - 200, y: rect.height * 0.4, scale: 1 });
          }}
          className="min-w-12 rounded-md px-2 text-sm font-semibold text-slate-200 hover:bg-slate-700"
        >
          {Math.round(camera.scale * 100)}%
        </button>
        <button
          type="button"
          title="Reinzoomen"
          onClick={() =>
            setCamera((cam) => {
              const scale = clampScale(cam.scale * 1.25);
              const k = scale / cam.scale;
              const cx = containerRef.current!.clientWidth / 2;
              const cy = containerRef.current!.clientHeight / 2;
              return { scale, x: cx - (cx - cam.x) * k, y: cy - (cy - cam.y) * k };
            })
          }
          className="h-8 w-8 rounded-md text-slate-200 hover:bg-slate-700"
        >
          +
        </button>
      </div>

      {uploadingCount > 0 && (
        <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-lg border border-[var(--border)] bg-[var(--panel)]/95 px-4 py-1.5 text-sm text-[var(--text-h)] shadow backdrop-blur">
          Bild wird hochgeladen…
        </div>
      )}
    </div>
  );
}
