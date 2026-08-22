import {
  useMemo,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import DOMPurify from 'dompurify';
import type { WhiteboardElement, WhiteboardPatch } from '../../../shared/types';
import { TASK_STATUS_META, isBoardImageUrl, nextTaskStatus } from './whiteboardShared';
import { ensureHtml } from '../quillConfig';
import { useFitFontSize } from './useFitFontSize';
import { NoteQuillEditor } from './NoteQuillEditor';

/**
 * Content is laid out in this fixed design width per element type and then
 * scaled by element.width / designWidth. Text, icons and paddings therefore
 * grow/shrink with the element while staying vector-crisp.
 */
const DESIGN_WIDTHS: Record<string, number> = {
  note: 220,
  task: 280,
  link: 260,
};

const MIN_CONTENT_SCALE = 0.15;
const MAX_CONTENT_SCALE = 12;

/**
 * Overlay controls (lock badge, delete/edit/layer buttons, resize grip) scale
 * with contentScale but never render smaller than MIN_UI_SCREEN_PX on screen:
 * below that size circles rasterize as oval blobs and hit targets become
 * unusable, so uiScale compensates for camera zoom-out.
 */
const BASE_CONTROL_SIZE = 24;
const MIN_UI_SCREEN_PX = 16;

function LockIcon({ open, size = 12 }: { open: boolean; size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      {open ? <path d="M8 11V7a4 4 0 0 1 7.83-1.26" /> : <path d="M8 11V7a4 4 0 0 1 8 0v4" />}
    </svg>
  );
}

interface WhiteboardElementViewProps {
  element: WhiteboardElement;
  selected: boolean;
  editing: boolean;
  dragging: boolean;
  cropping: boolean;
  /** Current whiteboard camera zoom, used to keep overlay controls legible. */
  cameraScale: number;
  onPointerDown: (event: ReactPointerEvent, element: WhiteboardElement) => void;
  onStartResize: (event: ReactPointerEvent, element: WhiteboardElement) => void;
  onRequestEdit: (id: string) => void;
  onCloseEdit: () => void;
  onUpdate: (id: string, patch: WhiteboardPatch) => void;
  onDelete: (id: string) => void;
  onCropApply: (crop: { x: number; y: number; w: number; h: number }) => void;
  onCropCancel: () => void;
  /** False when the element already sits at the top/bottom of the stack. */
  canBringForward: boolean;
  canSendBackward: boolean;
  onBringForward: (id: string) => void;
  onSendBackward: (id: string) => void;
}

interface NoteDraftProps {
  element: WhiteboardElement;
  onUpdate: (id: string, patch: WhiteboardPatch) => void;
  onCloseEdit: () => void;
}

function useFocusOnMount<T extends HTMLElement & { select: () => void }>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return ref;
}

/**
 * Blurs arriving within this window after mount are focus races caused by
 * the opening gesture's compat mouse events shifting focus to <body>, not
 * real user commits. They are ignored and focus is restored instead.
 */
const BLUR_GRACE_MS = 150;

function useBlurGuard(ref: RefObject<HTMLElement | null>) {
  const mountedAt = useRef(performance.now());
  return () => {
    if (performance.now() - mountedAt.current < BLUR_GRACE_MS) {
      ref.current?.focus();
      return true;
    }
    return false;
  };
}

function commitField(
  element: WhiteboardElement,
  patch: WhiteboardPatch,
  onUpdate: NoteDraftProps['onUpdate'],
  onCloseEdit: () => void
) {
  onUpdate(element.id, patch);
  onCloseEdit();
}

function TaskEditor({ element, onUpdate, onCloseEdit }: NoteDraftProps) {
  const [title, setTitle] = useState(element.text);
  const [description, setDescription] = useState(element.description ?? '');
  const titleRef = useFocusOnMount<HTMLInputElement>();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const shouldIgnoreBlur = useBlurGuard(wrapperRef);
  return (
    <div
      ref={wrapperRef}
      className="flex h-full flex-col gap-1"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        ref={titleRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (shouldIgnoreBlur()) return;
          commitField(element, { text: title, description }, onUpdate, onCloseEdit);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCloseEdit();
          }
          if (e.key === 'Enter') {
            commitField(element, { text: title, description }, onUpdate, onCloseEdit);
          }
        }}
        className="w-full rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-sm font-semibold text-[var(--text-h)] outline-none"
        placeholder="Aufgabe…"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => {
          if (shouldIgnoreBlur()) return;
          commitField(element, { text: title, description }, onUpdate, onCloseEdit);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCloseEdit();
          }
        }}
        className="min-h-0 flex-1 resize-none rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-xs text-[var(--text)] outline-none"
        placeholder="Beschreibung (optional)…"
      />
    </div>
  );
}

function LinkEditor({ element, onUpdate, onCloseEdit }: NoteDraftProps) {
  const [url, setUrl] = useState(element.url ?? '');
  const [label, setLabel] = useState(element.text);
  const ref = useFocusOnMount<HTMLInputElement>();
  const shouldIgnoreBlur = useBlurGuard(ref);
  return (
    <div
      className="flex h-full flex-col justify-center gap-1"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        ref={ref}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onBlur={() => {
          if (shouldIgnoreBlur()) return;
          commitField(element, { url: url.trim(), text: label }, onUpdate, onCloseEdit);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCloseEdit();
          }
          if (e.key === 'Enter') {
            commitField(element, { url: url.trim(), text: label }, onUpdate, onCloseEdit);
          }
        }}
        className="w-full rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-xs text-[var(--text-h)] outline-none"
        placeholder="https://…"
      />
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => {
          if (shouldIgnoreBlur()) return;
          commitField(element, { url: url.trim(), text: label }, onUpdate, onCloseEdit);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCloseEdit();
          }
        }}
        className="w-full rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-xs text-[var(--text)] outline-none"
        placeholder="Titel (optional)"
      />
    </div>
  );
}

/**
 * Vector outline for type "shape". The SVG stretches with the element box
 * (preserveAspectRatio="none"), so resizing distorts the outline just like
 * an image card would.
 */
function ShapeSvg({ element }: { element: WhiteboardElement }) {
  const w = element.width;
  const h = element.height;
  const s = element.strokeWidth;
  const half = s / 2;
  let outline: ReactNode;
  switch (element.shapeKind) {
    case 'ellipse':
      outline = (
        <ellipse
          cx={w / 2}
          cy={h / 2}
          rx={Math.max(0.5, w / 2 - half)}
          ry={Math.max(0.5, h / 2 - half)}
        />
      );
      break;
    case 'triangle':
      outline = <polygon points={`${w / 2},${half} ${w - half},${h - half} ${half},${h - half}`} />;
      break;
    case 'diamond':
      outline = (
        <polygon
          points={`${w / 2},${half} ${w - half},${h / 2} ${w / 2},${h - half} ${half},${h / 2}`}
        />
      );
      break;
    default:
      outline = (
        <rect
          x={half}
          y={half}
          width={Math.max(0.5, w - s)}
          height={Math.max(0.5, h - s)}
          rx={10}
        />
      );
  }
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <g
        fill={element.fillColor ?? 'none'}
        stroke={element.color}
        strokeWidth={s}
        strokeLinejoin="round"
      >
        {outline}
      </g>
    </svg>
  );
}

/** Freehand polyline for type "stroke", stretched across the element box. */
function StrokeSvg({ element }: { element: WhiteboardElement }) {
  const d = (element.points ?? [])
    .map(
      ([nx, ny], i) =>
        `${i === 0 ? 'M' : 'L'}${(nx * element.width).toFixed(2)},${(ny * element.height).toFixed(2)}`
    )
    .join(' ');
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox={`0 0 ${element.width} ${element.height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <path
        d={d || undefined}
        fill="none"
        stroke={element.color}
        strokeWidth={element.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WhiteboardElementView({
  element,
  selected,
  editing,
  dragging,
  cropping,
  cameraScale,
  onPointerDown,
  onStartResize,
  onRequestEdit,
  onCloseEdit,
  onUpdate,
  onDelete,
  onCropApply,
  onCropCancel,
  canBringForward,
  canSendBackward,
  onBringForward,
  onSendBackward,
}: WhiteboardElementViewProps) {
  const isImageLink = element.type === 'link' && isBoardImageUrl(element.url ?? '');
  const isNote = element.type === 'note';
  const sanitizedNoteHtml = useMemo(() => {
    if (!isNote) return '';
    return DOMPurify.sanitize(ensureHtml(element.text), {
      USE_PROFILES: { html: true },
      ADD_ATTR: ['style'],
    });
  }, [isNote, element.text]);
  const designWidth = DESIGN_WIDTHS[element.type] ?? element.width;
  const contentScale = Math.min(
    MAX_CONTENT_SCALE,
    Math.max(MIN_CONTENT_SCALE, element.width / designWidth)
  );
  const uiScale = Math.max(contentScale, MIN_UI_SCREEN_PX / (BASE_CONTROL_SIZE * cameraScale));
  // Notes auto-fit their text into this box (design units minus padding).
  const noteFit = useFitFontSize(
    element.text,
    designWidth - 16,
    element.height / contentScale - 16,
    isNote && !!element.text.trim()
  );
  let body: ReactNode = null;

  if (element.type === 'note') {
    body = (
      <div
        className="flex h-full w-full items-center justify-center overflow-hidden rounded-lg p-2 shadow"
        style={{ backgroundColor: element.color }}
      >
        {editing ? (
          <NoteQuillEditor
            element={element}
            onUpdate={onUpdate}
            onCloseEdit={onCloseEdit}
            boxWidth={designWidth - 16}
            boxHeight={element.height / contentScale - 16}
          />
        ) : !element.text ? (
          <span className="text-sm italic opacity-50">Doppelklick zum Schreiben</span>
        ) : (
          <div
            ref={noteFit.ref as RefObject<HTMLDivElement>}
            className="w-full break-words leading-[1.15] text-slate-900"
            style={{ fontSize: noteFit.fontSize }}
          >
            <div className="whiteboard-note-content">
              <div className="ql-editor" dangerouslySetInnerHTML={{ __html: sanitizedNoteHtml }} />
            </div>
          </div>
        )}
      </div>
    );
  } else if (element.type === 'task') {
    const status = element.status ?? 'open';
    const meta = TASK_STATUS_META[status];
    body = (
      <div
        className="relative flex h-full w-full flex-col gap-1 overflow-hidden rounded-lg bg-[var(--panel)] p-2 pl-3 shadow"
        style={{ borderTop: `4px solid ${element.color}` }}
      >
        {editing ? (
          <TaskEditor element={element} onUpdate={onUpdate} onCloseEdit={onCloseEdit} />
        ) : (
          <>
            <div className="break-words text-sm font-semibold leading-tight text-[var(--text-h)]">
              {element.text || <span className="italic opacity-50">Doppelklick für Aufgabe</span>}
            </div>
            {element.description && (
              <div className="line-clamp-3 whitespace-pre-wrap break-words text-xs text-[var(--text)]">
                {element.description}
              </div>
            )}
            <button
              type="button"
              onPointerDown={(e) => {
                if (e.button === 0) e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                onUpdate(element.id, { status: nextTaskStatus(status) });
              }}
              className={`mt-auto self-start rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.className}`}
              title="Status ändern"
            >
              {meta.label}
            </button>
          </>
        )}
      </div>
    );
  } else if (element.type === 'link') {
    const isImage = element.url ? isBoardImageUrl(element.url) : false;
    body = (
      <div className="group relative h-full w-full overflow-hidden rounded-lg border-2 border-[var(--border)] bg-[var(--panel)] shadow">
        {editing ? (
          <div className="h-full w-full p-2">
            <LinkEditor element={element} onUpdate={onUpdate} onCloseEdit={onCloseEdit} />
          </div>
        ) : isImage && element.url ? (
          <img
            src={element.url}
            alt={element.text || 'Vorschau'}
            draggable={false}
            className="pointer-events-none h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col justify-center gap-0.5 p-2">
            <div className="truncate text-sm font-medium text-[var(--accent)]">
              {element.text || element.url || (
                <span className="italic opacity-50">Link hinterlegen</span>
              )}
            </div>
            {element.url && <div className="truncate text-xs text-slate-400">{element.url}</div>}
          </div>
        )}
      </div>
    );
  } else if (element.type === 'shape') {
    body = <ShapeSvg element={element} />;
  } else if (element.type === 'stroke') {
    body = <StrokeSvg element={element} />;
  }

  return (
    <div
      data-whiteboard-element={element.id}
      className={`absolute select-none ${
        selected ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-transparent' : ''
      }`}
      style={{
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.height,
        cursor: editing ? 'default' : dragging ? 'grabbing' : element.locked ? 'default' : 'grab',
      }}
      onPointerDown={(e) => {
        if (!editing) onPointerDown(e, element);
      }}
      onDoubleClick={() => {
        if (!editing) onRequestEdit(element.id);
      }}
    >
      {/* Content layer: fixed design width scaled to the element box so text
          and icons always match the element size. */}
      <div className="absolute inset-0 overflow-hidden rounded-lg">
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            width: designWidth,
            height: element.height / contentScale,
            transform: `scale(${contentScale})`,
          }}
        >
          {body}
        </div>
      </div>
      {element.locked && !selected && !editing && !cropping && (
        <div
          className="pointer-events-none absolute z-10 flex items-center justify-center rounded-full bg-slate-700 text-slate-200 shadow"
          style={{
            left: -10 * uiScale,
            top: -10 * uiScale,
            width: 20 * uiScale,
            height: 20 * uiScale,
          }}
        >
          <LockIcon open={false} size={11 * uiScale} />
        </div>
      )}
      {selected && !editing && !cropping && (
        <>
          <button
            type="button"
            title="Löschen"
            onPointerDown={(e) => {
              if (e.button === 0) e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(element.id);
            }}
            className="absolute z-10 flex items-center justify-center rounded-full bg-[var(--danger)] p-0 text-white shadow hover:brightness-110"
            style={{
              width: 24 * uiScale,
              height: 24 * uiScale,
              right: -12 * uiScale,
              top: -12 * uiScale,
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width={12 * uiScale}
              height={12 * uiScale}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <button
            type="button"
            title={isImageLink ? 'Zuschneiden' : 'Bearbeiten'}
            onPointerDown={(e) => {
              if (e.button === 0) e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              onRequestEdit(element.id);
            }}
            className="absolute z-10 flex items-center justify-center rounded-full bg-[var(--accent)] text-slate-900 shadow hover:brightness-110"
            style={{
              width: 24 * uiScale,
              height: 24 * uiScale,
              right: -12 * uiScale,
              top: 28 * uiScale,
            }}
          >
            {isImageLink ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width={12 * uiScale}
                height={12 * uiScale}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 2v14a2 2 0 0 0 2 2h14" />
                <path d="M18 22V8a2 2 0 0 0-2-2H2" />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width={12 * uiScale}
                height={12 * uiScale}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
              </svg>
            )}
          </button>
          <button
            type="button"
            title={element.locked ? 'Lösen (wieder verschiebbar)' : 'Fixieren (nicht verschiebbar)'}
            onPointerDown={(e) => {
              if (e.button === 0) e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              onUpdate(element.id, { locked: !element.locked });
            }}
            className={`absolute z-10 flex items-center justify-center rounded-full text-white shadow hover:brightness-110 ${
              element.locked ? 'bg-[var(--warning)]' : 'bg-slate-600'
            }`}
            style={{
              width: 24 * uiScale,
              height: 24 * uiScale,
              left: -12 * uiScale,
              top: -12 * uiScale,
            }}
          >
            <LockIcon open={!element.locked} size={12 * uiScale} />
          </button>
          {(
            [
              {
                title: 'Ebene nach vorn',
                enabled: canBringForward && !element.locked,
                onClick: () => onBringForward(element.id),
                icon: <path d="M12 19V5m0 0-6 6m6-6 6 6" />,
              },
              {
                title: 'Ebene nach hinten',
                enabled: canSendBackward && !element.locked,
                onClick: () => onSendBackward(element.id),
                icon: <path d="M12 5v14m0 0 6-6m-6 6-6-6" />,
              },
            ] as const
          ).map((control) => (
            <button
              key={control.title}
              type="button"
              title={control.enabled ? control.title : `${control.title} (nicht möglich)`}
              aria-label={control.title}
              disabled={!control.enabled}
              onPointerDown={(e) => {
                if (e.button === 0) e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                control.onClick();
              }}
              className={`absolute z-10 flex items-center justify-center rounded-full bg-slate-600 p-0 text-white shadow ${
                control.enabled ? 'hover:brightness-110' : 'opacity-40'
              }`}
              style={{
                width: 24 * uiScale,
                height: 24 * uiScale,
                left: -12 * uiScale,
                top: (control.title === 'Ebene nach vorn' ? 28 : 56) * uiScale,
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width={14 * uiScale}
                height={14 * uiScale}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {control.icon}
              </svg>
            </button>
          ))}
          {!element.locked && (
            <div
              title="Größe ändern"
              onPointerDown={(e) => {
                // Right/middle presses fall through to the board pan.
                if (e.button !== 0) return;
                e.stopPropagation();
                onStartResize(e, element);
              }}
              className="absolute cursor-nwse-resize rounded-sm border-[var(--accent)] bg-[var(--panel)]"
              style={{
                width: 16 * uiScale,
                height: 16 * uiScale,
                right: -8 * uiScale,
                bottom: -8 * uiScale,
                borderWidth: Math.max(1.5, 2 * uiScale),
              }}
            />
          )}
        </>
      )}
      {cropping && <CropOverlay onApply={onCropApply} onCancel={onCropCancel} />}
    </div>
  );
}

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const CROP_MIN = 0.08;

function clampCrop(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function CropOverlay({
  onApply,
  onCancel,
}: {
  onApply: (crop: CropRect) => void;
  onCancel: () => void;
}) {
  const [rect, setRect] = useState<CropRect>({ x: 0, y: 0, w: 1, h: 1 });
  const rootRef = useRef<HTMLDivElement | null>(null);

  const toPercent = (clientX: number, clientY: number) => {
    const bounds = rootRef.current!.getBoundingClientRect();
    return {
      px: clampCrop((clientX - bounds.left) / bounds.width, 0, 1),
      py: clampCrop((clientY - bounds.top) / bounds.height, 0, 1),
    };
  };

  const beginDrag = (mode: 'move' | 'nw' | 'ne' | 'sw' | 'se', e: ReactPointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const start = toPercent(e.clientX, e.clientY);
    const base = { ...rect };
    const move = (ev: PointerEvent) => {
      const p = toPercent(ev.clientX, ev.clientY);
      setRect((prev) => {
        if (mode === 'move') {
          return {
            ...prev,
            x: clampCrop(base.x + (p.px - start.px), 0, 1 - base.w),
            y: clampCrop(base.y + (p.py - start.py), 0, 1 - base.h),
          };
        }
        let { x, y, w, h } = base;
        if (mode === 'se') {
          w = clampCrop(p.px - x, CROP_MIN, 1 - x);
          h = clampCrop(p.py - y, CROP_MIN, 1 - y);
        } else if (mode === 'nw') {
          const rightEdge = x + w;
          const bottomEdge = y + h;
          x = clampCrop(p.px, 0, rightEdge - CROP_MIN);
          w = rightEdge - x;
          y = clampCrop(p.py, 0, bottomEdge - CROP_MIN);
          h = bottomEdge - y;
        } else if (mode === 'ne') {
          const bottomEdge = y + h;
          w = clampCrop(p.px - x, CROP_MIN, 1 - x);
          y = clampCrop(p.py, 0, bottomEdge - CROP_MIN);
          h = bottomEdge - y;
        } else {
          const rightEdge = x + w;
          x = clampCrop(p.px, 0, rightEdge - CROP_MIN);
          w = rightEdge - x;
          h = clampCrop(p.py - y, CROP_MIN, 1 - y);
        }
        return { x, y, w, h };
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const HANDLE_SIZE = 14;
  const halfHandle = -HANDLE_SIZE / 2;
  const handleStyle = (mode: 'nw' | 'ne' | 'sw' | 'se') => ({
    position: 'absolute' as const,
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    left: mode === 'nw' || mode === 'sw' ? halfHandle : undefined,
    right: mode === 'ne' || mode === 'se' ? halfHandle : undefined,
    top: mode === 'nw' || mode === 'ne' ? halfHandle : undefined,
    bottom: mode === 'sw' || mode === 'se' ? halfHandle : undefined,
    cursor: `${mode}-resize`,
  });

  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-20">
        <div
          className="absolute bg-black/55"
          style={{ left: 0, top: 0, width: '100%', height: `${rect.y * 100}%` }}
        />
        <div
          className="absolute bg-black/55"
          style={{ left: 0, bottom: 0, width: '100%', height: `${(1 - rect.y - rect.h) * 100}%` }}
        />
        <div
          className="absolute bg-black/55"
          style={{
            left: 0,
            top: `${rect.y * 100}%`,
            width: `${rect.x * 100}%`,
            height: `${rect.h * 100}%`,
          }}
        />
        <div
          className="absolute bg-black/55"
          style={{
            right: 0,
            top: `${rect.y * 100}%`,
            width: `${(1 - rect.x - rect.w) * 100}%`,
            height: `${rect.h * 100}%`,
          }}
        />
      </div>
      <div ref={rootRef} className="absolute inset-0 z-30">
        <div
          className="absolute cursor-move border-2 border-[var(--accent)] shadow-[0_0_0_9999px_rgba(0,0,0,0)]"
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.w * 100}%`,
            height: `${rect.h * 100}%`,
          }}
          onPointerDown={(e) => beginDrag('move', e)}
        >
          <div
            className="rounded-full border-2 border-[var(--panel)] bg-[var(--accent)]"
            style={handleStyle('nw')}
            onPointerDown={(e) => beginDrag('nw', e)}
          />
          <div
            className="rounded-full border-2 border-[var(--panel)] bg-[var(--accent)]"
            style={handleStyle('ne')}
            onPointerDown={(e) => beginDrag('ne', e)}
          />
          <div
            className="rounded-full border-2 border-[var(--panel)] bg-[var(--accent)]"
            style={handleStyle('sw')}
            onPointerDown={(e) => beginDrag('sw', e)}
          />
          <div
            className="rounded-full border-2 border-[var(--panel)] bg-[var(--accent)]"
            style={handleStyle('se')}
            onPointerDown={(e) => beginDrag('se', e)}
          />
        </div>
        <div className="absolute flex gap-2" style={{ left: 8, top: 'calc(100% + 10px)' }}>
          <button
            type="button"
            title="Zuschneiden übernehmen"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onApply(rect);
            }}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-slate-900 shadow hover:brightness-110"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width={14}
              height={14}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
          <button
            type="button"
            title="Abbrechen"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-600 text-white shadow hover:brightness-110"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width={12}
              height={12}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}
