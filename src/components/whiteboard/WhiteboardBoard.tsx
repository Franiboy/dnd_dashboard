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
import { ARROW_COLOR, type WhiteboardTool } from './whiteboardShared';

const MIN_SCALE = 0.02;
const MAX_SCALE = 20;
const PUBLIC_BAND_HEIGHT = 1200;
const BAND_EXTENT = 200_000;
const EMIT_INTERVAL_MS = 80;

const DEFAULT_SIZES = {
  note: { width: 220, height: 160 },
  task: { width: 280, height: 190 },
  link: { width: 260, height: 130 },
} as const;

interface Camera {
  x: number;
  y: number;
  scale: number;
}

type Gesture =
  | { kind: 'pan'; lastX: number; lastY: number }
  | {
      kind: 'create';
      startWX: number;
      startWY: number;
      anchorFromId: string | null;
    }
  | {
      kind: 'move';
      id: string;
      isArrow: boolean;
      grabDX: number;
      grabDY: number;
      downX: number;
      downY: number;
      lastEmit: number;
    }
  | {
      kind: 'resize';
      id: string;
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
  onToolChange: (tool: WhiteboardTool) => void;
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
  onToolChange,
  createElement,
  applyPatchLocal,
  updateElement,
  removeElement,
  beginLocalEdit,
  endLocalEdit,
}: WhiteboardBoardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: 1 });
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const gestureRef = useRef<Gesture | null>(null);
  // Manual double-click tracking: element gestures deliberately avoid pointer
  // capture because it retargets native click/dblclick events away from the
  // element, so we detect two quick taps ourselves.
  const lastTapRef = useRef<{ id: string; x: number; y: number; t: number } | null>(null);
  const [rectPreview, setRectPreview] = useState<RectPreview | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Drives cursor feedback: open hand on hover comes from the elements
  // themselves; closed hand while panning or dragging an element.
  const [cursorMode, setCursorMode] = useState<'idle' | 'panning' | 'dragging'>('idle');

  // Window-level listeners keep drags alive outside the canvas bounds. They
  // delegate to the freshest closures via refs to avoid stale state.
  const windowMoveRef = useRef<((e: PointerEvent) => void) | null>(null);
  const windowUpRef = useRef<((e: PointerEvent) => void) | null>(null);

  const elementsById = useMemo(() => new Map(elements.map((e) => [e.id, e])), [elements]);

  const canEdit = useCallback(
    (element: WhiteboardElement) => element.zone === 'public' || element.ownerId === user.id,
    [user.id]
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
      const inField = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (e.key === 'Escape') {
        setEditingId(null);
        setSelectedId(null);
        if (tool !== 'select') onToolChange('select');
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !inField && selectedId) {
        const element = elementsById.get(selectedId);
        if (element && canEdit(element)) {
          removeElement(selectedId);
          setSelectedId(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [elementsById, selectedId, tool, onToolChange, removeElement, canEdit]);

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

  const findElementAt = useCallback(
    (wx: number, wy: number): WhiteboardElement | undefined => {
      for (let i = elements.length - 1; i >= 0; i -= 1) {
        const el = elements[i];
        if (el.type === 'arrow') continue;
        if (wx >= el.x && wx <= el.x + el.width && wy >= el.y && wy <= el.y + el.height) {
          return el;
        }
      }
      return undefined;
    },
    [elements]
  );

  const finishCreate = useCallback(
    (gesture: Extract<Gesture, { kind: 'create' }>, wx: number, wy: number) => {
      const now = new Date().toISOString();

      if (tool === 'arrow') {
        const toHit = findElementAt(wx, wy);
        const fromHit = gesture.anchorFromId ? elementsById.get(gesture.anchorFromId) : undefined;
        const start = fromHit ? centerOf(fromHit) : { x: gesture.startWX, y: gesture.startWY };
        const end = toHit ? centerOf(toHit) : { x: wx, y: wy };
        if (Math.hypot(end.x - start.x, end.y - start.y) < 12) {
          onToolChange('select');
          return;
        }
        const id = crypto.randomUUID();
        createElement({
          id,
          type: 'arrow',
          zone: zoneForWorldY((start.y + end.y) / 2),
          ownerId: user.id,
          ownerName: user.displayName,
          x: start.x,
          y: start.y,
          x2: end.x,
          y2: end.y,
          width: 0,
          height: 0,
          color: ARROW_COLOR,
          text: '',
          description: null,
          status: null,
          url: null,
          fromId: fromHit?.id ?? null,
          toId: toHit?.id ?? null,
          locked: false,
          createdAt: now,
          updatedAt: now,
        });
        setSelectedId(id);
        onToolChange('select');
        return;
      }

      if (tool !== 'note' && tool !== 'task' && tool !== 'link') return;
      let width = Math.abs(wx - gesture.startWX);
      let height = Math.abs(wy - gesture.startWY);
      let px = Math.min(gesture.startWX, wx);
      let py = Math.min(gesture.startWY, wy);
      const def = DEFAULT_SIZES[tool];
      if (width < 40 || height < 40) {
        width = def.width;
        height = def.height;
        px = gesture.startWX - width / 2;
        py = gesture.startWY - height / 2;
      }
      const id = crypto.randomUUID();
      createElement({
        id,
        type: tool,
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
        description: tool === 'task' ? '' : null,
        status: tool === 'task' ? 'open' : null,
        url: null,
        fromId: null,
        toId: null,
        locked: false,
        createdAt: now,
        updatedAt: now,
      });
      setSelectedId(id);
      onToolChange('select');
    },
    [
      tool,
      color,
      user.id,
      user.displayName,
      elementsById,
      findElementAt,
      createElement,
      onToolChange,
    ]
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

    if (g.kind === 'create') {
      setRectPreview((prev) => (prev ? { ...prev, x2: wx, y2: wy } : prev));
      return;
    }

    if (g.kind === 'move') {
      const nx = wx - g.grabDX;
      const ny = wy - g.grabDY;
      if (g.isArrow) {
        const el = elementsById.get(g.id);
        if (!el || el.type !== 'arrow') return;
        const dx = nx - el.x;
        const dy = ny - el.y;
        applyPatchLocal(g.id, {
          x: nx,
          y: ny,
          x2: (el.x2 ?? 0) + dx,
          y2: (el.y2 ?? 0) + dy,
        });
        if (performance.now() - g.lastEmit > EMIT_INTERVAL_MS) {
          g.lastEmit = performance.now();
          updateElement(g.id, {
            x: nx,
            y: ny,
            x2: (el.x2 ?? 0) + dx,
            y2: (el.y2 ?? 0) + dy,
          });
        }
        return;
      }
      applyPatchLocal(g.id, { x: nx, y: ny });
      if (performance.now() - g.lastEmit > EMIT_INTERVAL_MS) {
        g.lastEmit = performance.now();
        updateElement(g.id, { x: nx, y: ny });
      }
      return;
    }

    if (g.kind === 'resize') {
      const el = elementsById.get(g.id);
      if (!el) return;
      const nw = Math.max(80, wx - el.x);
      const nh = Math.max(60, wy - el.y);
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
    if (g.kind === 'move') {
      const el = elementsById.get(g.id);
      if (el) {
        if (el.type === 'arrow') {
          updateElement(el.id, { x: el.x, y: el.y, x2: el.x2, y2: el.y2 });
        } else {
          updateElement(el.id, { x: el.x, y: el.y });
          // A click without movement on a link card opens its URL. Handled
          // here because element drags avoid pointer capture on purpose.
          const moved = Math.hypot(clientX - g.downX, clientY - g.downY);
          if (!g.isArrow && el.type === 'link' && el.url && moved < 5) {
            window.open(el.url, '_blank', 'noopener,noreferrer');
          }
        }
      }
      endLocalEdit(g.id);
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

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (editingId) return;
    if (e.button !== 0 && e.button !== 1) return;
    const { wx, wy } = screenToWorld(e.clientX, e.clientY);

    if (tool === 'select') {
      // Pressing empty canvas drops the current selection and pans.
      setSelectedId(null);
      gestureRef.current = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
      bindWindowGesture();
      setCursorMode('panning');
      return;
    }
    const hit = findElementAt(wx, wy);
    gestureRef.current = {
      kind: 'create',
      startWX: wx,
      startWY: wy,
      anchorFromId: tool === 'arrow' ? (hit?.id ?? null) : null,
    };
    setRectPreview({ x1: wx, y1: wy, x2: wx, y2: wy });
    bindWindowGesture();
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    runGestureMove(e.clientX, e.clientY);
  };

  const finishGesture = (e: ReactPointerEvent<HTMLDivElement>) => {
    finishGestureCore(e.clientX, e.clientY);
  };

  const startElementDrag = (event: ReactPointerEvent, element: WhiteboardElement) => {
    event.stopPropagation();
    setSelectedId(element.id);
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
    if (!canEdit(element) || element.locked) {
      setCursorMode('panning');
      gestureRef.current = { kind: 'pan', lastX: event.clientX, lastY: event.clientY };
      return;
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
      lastEmit: performance.now(),
    };
    beginLocalEdit(element.id);
  };

  const startElementResize = (event: ReactPointerEvent, element: WhiteboardElement) => {
    event.stopPropagation();
    if (!canEdit(element) || element.locked) return;
    bindWindowGesture();
    setCursorMode('dragging');
    gestureRef.current = {
      kind: 'resize',
      id: element.id,
      startW: element.width,
      startH: element.height,
      lastEmit: performance.now(),
    };
    beginLocalEdit(element.id);
    setSelectedId(element.id);
  };

  const startArrowDrag = (event: ReactPointerEvent, element: WhiteboardElement) => {
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
      lastEmit: performance.now(),
    };
    beginLocalEdit(element.id);
    setSelectedId(element.id);
  };

  const openEdit = (id: string) => {
    const element = elementsById.get(id);
    if (!element || !canEdit(element)) return;
    setEditingId(id);
    beginLocalEdit(id);
  };

  const closeEdit = () => {
    if (editingId) endLocalEdit(editingId);
    setEditingId(null);
  };

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
    >
      <div
        className="absolute left-0 top-0 h-0 w-0 will-change-transform"
        style={{
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
          transformOrigin: '0 0',
        }}
      >
        <div
          className="pointer-events-none absolute border-b-2 border-[var(--accent)]/50 bg-[var(--accent)]/5"
          style={{
            left: -BAND_EXTENT,
            top: WHITEBOARD_DIVIDER_Y - PUBLIC_BAND_HEIGHT,
            width: BAND_EXTENT * 2,
            height: PUBLIC_BAND_HEIGHT,
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
            const selected = selectedId === arrow.id;
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
          tool !== 'arrow' &&
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

        {rectPreview && tool === 'arrow' && (
          <svg
            className="pointer-events-none absolute overflow-visible"
            style={{ left: 0, top: 0 }}
            width={1}
            height={1}
          >
            <line
              x1={rectPreview.x1}
              y1={rectPreview.y1}
              x2={rectPreview.x2}
              y2={rectPreview.y2}
              stroke={ARROW_COLOR}
              strokeWidth={3}
              strokeDasharray="8 6"
              strokeLinecap="round"
            />
          </svg>
        )}

        {elements
          .filter((e) => e.type !== 'arrow')
          .map((element) => (
            <WhiteboardElementView
              key={element.id}
              element={element}
              selected={selectedId === element.id && !editingId}
              editing={editingId === element.id}
              dragging={cursorMode === 'dragging'}
              onPointerDown={startElementDrag}
              onStartResize={startElementResize}
              onRequestEdit={(id) => {
                setSelectedId(id);
                openEdit(id);
              }}
              onCloseEdit={closeEdit}
              onUpdate={(id, patch) => updateElement(id, patch)}
              onDelete={(id) => {
                removeElement(id);
                if (selectedId === id) setSelectedId(null);
              }}
            />
          ))}
      </div>

      <div
        className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-[var(--accent)]/60"
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

      {selectedId && !editingId && (
        <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2">
          <button
            type="button"
            onClick={() => {
              const element = elementsById.get(selectedId);
              if (element && canEdit(element)) {
                removeElement(selectedId);
                setSelectedId(null);
              }
            }}
            className="rounded-lg bg-[var(--danger)]/90 px-3 py-1.5 text-sm font-medium text-white shadow hover:brightness-110"
          >
            Auswahl löschen (Entf)
          </button>
        </div>
      )}
    </div>
  );
}
