import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { WhiteboardElement, WhiteboardPatch } from '../../../shared/types';
import { TASK_STATUS_META, nextTaskStatus } from './whiteboardShared';

const IMAGE_URL_RE = /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i;

interface WhiteboardElementViewProps {
  element: WhiteboardElement;
  selected: boolean;
  editing: boolean;
  onPointerDown: (event: ReactPointerEvent, element: WhiteboardElement) => void;
  onStartResize: (event: ReactPointerEvent, element: WhiteboardElement) => void;
  onOpenEdit: (id: string) => void;
  onCloseEdit: () => void;
  onUpdate: (id: string, patch: WhiteboardPatch) => void;
  onDelete: (id: string) => void;
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

function commitField(
  element: WhiteboardElement,
  patch: WhiteboardPatch,
  onUpdate: NoteDraftProps['onUpdate'],
  onCloseEdit: () => void
) {
  onUpdate(element.id, patch);
  onCloseEdit();
}

function NoteEditor({ element, onUpdate, onCloseEdit }: NoteDraftProps) {
  const [draft, setDraft] = useState(element.text);
  const ref = useFocusOnMount<HTMLTextAreaElement>();
  return (
    <textarea
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => commitField(element, { text: draft }, onUpdate, onCloseEdit)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCloseEdit();
        }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          commitField(element, { text: draft }, onUpdate, onCloseEdit);
        }
      }}
      className="h-full w-full resize-none rounded-md border border-slate-900/20 bg-white/40 p-1 text-slate-900 outline-none"
      placeholder="Notiz schreiben…"
    />
  );
}

function TaskEditor({ element, onUpdate, onCloseEdit }: NoteDraftProps) {
  const [title, setTitle] = useState(element.text);
  const [description, setDescription] = useState(element.description ?? '');
  const titleRef = useFocusOnMount<HTMLInputElement>();
  return (
    <div className="flex h-full flex-col gap-1" onPointerDown={(e) => e.stopPropagation()}>
      <input
        ref={titleRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => commitField(element, { text: title, description }, onUpdate, onCloseEdit)}
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
        onBlur={() => commitField(element, { text: title, description }, onUpdate, onCloseEdit)}
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
  return (
    <div
      className="flex h-full flex-col justify-center gap-1"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        ref={ref}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onBlur={() => commitField(element, { url: url.trim(), text: label }, onUpdate, onCloseEdit)}
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
        onBlur={() => commitField(element, { url: url.trim(), text: label }, onUpdate, onCloseEdit)}
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

export function WhiteboardElementView({
  element,
  selected,
  editing,
  onPointerDown,
  onStartResize,
  onOpenEdit,
  onCloseEdit,
  onUpdate,
  onDelete,
}: WhiteboardElementViewProps) {
  const downPosRef = useRef<{ x: number; y: number } | null>(null);

  const handleClick = (event: ReactMouseEvent) => {
    if (element.type !== 'link' || !element.url || editing) return;
    const down = downPosRef.current;
    downPosRef.current = null;
    if (!down) return;
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    if (moved > 4) return;
    window.open(element.url, '_blank', 'noopener,noreferrer');
  };

  let body: ReactNode = null;

  if (element.type === 'note') {
    body = (
      <div
        className="flex h-full w-full items-start overflow-hidden rounded-lg p-2 text-sm leading-snug text-slate-900 shadow"
        style={{ backgroundColor: element.color }}
      >
        {editing ? (
          <NoteEditor element={element} onUpdate={onUpdate} onCloseEdit={onCloseEdit} />
        ) : (
          <div className="whitespace-pre-wrap break-words">
            {element.text || <span className="italic opacity-50">Doppelklick zum Schreiben</span>}
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
              onPointerDown={(e) => e.stopPropagation()}
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
    const isImage = element.url ? IMAGE_URL_RE.test(element.url) : false;
    body = (
      <div className="group relative h-full w-full overflow-hidden rounded-lg border-2 border-[var(--border)] bg-[var(--panel)] shadow">
        {editing ? (
          <div className="h-full w-full p-2">
            <LinkEditor element={element} onUpdate={onUpdate} onCloseEdit={onCloseEdit} />
          </div>
        ) : isImage && element.url ? (
          <>
            <img
              src={element.url}
              alt={element.text || 'Vorschau'}
              draggable={false}
              className="pointer-events-none h-full w-full object-cover"
            />
            {element.text && (
              <div className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-2 py-0.5 text-xs text-white">
                {element.text}
              </div>
            )}
          </>
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
        cursor: editing ? 'default' : 'grab',
      }}
      onPointerDown={(e) => {
        downPosRef.current = { x: e.clientX, y: e.clientY };
        if (!editing) onPointerDown(e, element);
      }}
      onDoubleClick={() => {
        if (!editing) onOpenEdit(element.id);
      }}
      onClick={handleClick}
    >
      {body}
      {selected && !editing && (
        <>
          <button
            type="button"
            title="Löschen"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(element.id);
            }}
            className="absolute -right-3 -top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--danger)] text-xs font-bold text-white shadow hover:brightness-110"
          >
            ×
          </button>
          <div
            title="Größe ändern"
            onPointerDown={(e) => {
              e.stopPropagation();
              onStartResize(e, element);
            }}
            className="absolute -bottom-1.5 -right-1.5 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-[var(--accent)] bg-[var(--panel)]"
          />
        </>
      )}
    </div>
  );
}
