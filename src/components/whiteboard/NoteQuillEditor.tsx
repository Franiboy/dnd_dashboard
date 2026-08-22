import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactQuill from 'react-quill-new';
import type { WhiteboardElement } from '../../../shared/types';
import { ensureHtml, isEmptyHtml, quillFormats, quillModules } from '../quillConfig';
import 'react-quill-new/dist/quill.snow.css';

/** Grace window ignoring blurs caused by the opening gesture's focus races. */
const BLUR_GRACE_MS = 150;

const MIN_EDITOR_WIDTH = 440;
const MIN_EDITOR_HEIGHT = 280;

export interface NoteEditorAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface NoteQuillEditorProps {
  element: WhiteboardElement;
  anchor: NoteEditorAnchor;
  onCommit: (html: string) => void;
  onCancel: () => void;
}

/**
 * Screen-space rich text editor for one whiteboard note. Renders as a
 * floating panel anchored flush to the note's top edge, independent of
 * camera zoom, with the toolbar aligned to the panel's top.
 */
export function NoteQuillEditor({ element, anchor, onCommit, onCancel }: NoteQuillEditorProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const quillRef = useRef<ReactQuill | null>(null);
  const draftRef = useRef<string>(ensureHtml(element.text));
  const mountedAt = useRef(performance.now());
  const committedRef = useRef(false);
  const [rect, setRect] = useState(() => ({
    left: anchor.left,
    top: anchor.top,
    width: Math.max(anchor.width, MIN_EDITOR_WIDTH),
    height: Math.max(anchor.height, MIN_EDITOR_HEIGHT),
  }));

  // Clamp the panel into the board viewport without scaling it with zoom.
  useLayoutEffect(() => {
    const parent = wrapperRef.current?.parentElement;
    if (!parent) return;
    setRect((prev) => {
      const width = Math.min(prev.width, Math.max(240, parent.clientWidth - 16));
      const height = Math.min(prev.height, Math.max(200, parent.clientHeight - 16));
      const left = Math.min(Math.max(8, prev.left), Math.max(8, parent.clientWidth - width - 8));
      const top = Math.min(Math.max(8, prev.top), Math.max(8, parent.clientHeight - height - 8));
      return { left, top, width, height };
    });
  }, []);

  useEffect(() => {
    quillRef.current?.focus();
  }, []);

  // The board zooms via a native bubbling wheel listener on the container;
  // it never sees events stopped here, so scrolling text cannot zoom.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener('wheel', onWheel);
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    const html = draftRef.current.trim();
    onCommit(isEmptyHtml(html) ? '' : html);
  };

  return (
    <div
      ref={wrapperRef}
      className="note-quill-editor absolute z-30 flex flex-col overflow-hidden rounded-lg border-2 border-[var(--accent)] bg-[var(--panel)] shadow-2xl"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        touchAction: 'auto',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (wrapperRef.current?.contains(e.relatedTarget as Node)) return;
        if (performance.now() - mountedAt.current < BLUR_GRACE_MS) {
          quillRef.current?.focus();
          return;
        }
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          committedRef.current = true;
          onCancel();
        }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          commit();
        }
      }}
    >
      <ReactQuill
        ref={quillRef}
        defaultValue={ensureHtml(element.text)}
        onChange={(value) => {
          draftRef.current = value;
        }}
        modules={quillModules}
        formats={quillFormats}
        placeholder="Notiz schreiben…"
        className="flex min-h-0 flex-1 flex-col"
      />
    </div>
  );
}
