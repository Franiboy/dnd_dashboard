import { useEffect, useRef, useState, type RefObject } from 'react';
import ReactQuill from 'react-quill-new';
import type { WhiteboardElement, WhiteboardPatch } from '../../../shared/types';
import { ensureHtml, isEmptyHtml, quillFormats, quillModules } from '../quillConfig';
import { useFitFontSize } from './useFitFontSize';
import 'react-quill-new/dist/quill.snow.css';

/** DOM id of the docked toolbar rendered above the board while editing. */
export const NOTE_QUILL_TOOLBAR_ID = 'wb-note-quill-toolbar';

/** Grace window ignoring blurs caused by the opening gesture's focus races. */
const BLUR_GRACE_MS = 150;

/** Live-saving interval so typing does not emit one socket message per key. */
const LIVE_SAVE_DEBOUNCE_MS = 300;

const STROKE_ICON_PROPS = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  width: 18,
  height: 18,
  fill: 'none',
} as const;

function StrokePath({ d }: { d: string }) {
  return (
    <path
      d={d}
      className="ql-stroke"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

/**
 * Static snow-style toolbar markup. Quill wires controls by their ql-*
 * classes when configured with this element as external toolbar container,
 * so the full diary feature set stays available without a floating panel.
 */
export function NoteQuillToolbarMarkup() {
  return (
    <>
      <span className="ql-formats">
        <select className="ql-header" title="Überschrift">
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option selected />
        </select>
        <button type="button" className="ql-bold" title="Fett">
          <svg {...STROKE_ICON_PROPS}>
            <StrokePath d="M7 4h6a4 4 0 0 1 0 8H7z" />
            <StrokePath d="M7 12h7a4 4 0 0 1 0 8H7z" />
          </svg>
        </button>
        <button type="button" className="ql-italic" title="Kursiv">
          <svg {...STROKE_ICON_PROPS}>
            <StrokePath d="M19 4h-9" />
            <StrokePath d="M14 20H5" />
            <StrokePath d="M15 4 9 20" />
          </svg>
        </button>
        <button type="button" className="ql-underline" title="Unterstrichen">
          <svg {...STROKE_ICON_PROPS}>
            <StrokePath d="M6 3v7a6 6 0 0 0 12 0V3" />
            <StrokePath d="M4 21h16" />
          </svg>
        </button>
        <button type="button" className="ql-strike" title="Durchgestrichen">
          <svg {...STROKE_ICON_PROPS}>
            <StrokePath d="M16 4H9a3 3 0 0 0-2.6 4.5" />
            <StrokePath d="M15 12a4 4 0 0 1-.5 8H6" />
            <StrokePath d="M4 12h16" />
          </svg>
        </button>
      </span>
      <span className="ql-formats">
        <select className="ql-color" title="Textfarbe" />
        <select className="ql-background" title="Hervorheben" />
      </span>
      <span className="ql-formats">
        <select className="ql-align" title="Ausrichtung">
          <option value="" />
          <option value="center" />
          <option value="right" />
          <option value="justify" />
        </select>
      </span>
      <span className="ql-formats">
        <button type="button" className="ql-list" value="ordered" title="Nummerierte Liste">
          <svg {...STROKE_ICON_PROPS}>
            <StrokePath d="M9 6h12" />
            <StrokePath d="M9 12h12" />
            <StrokePath d="M9 18h12" />
            <StrokePath d="M4 5h1v4" />
            <StrokePath d="M4 11h2v6H4z" />
          </svg>
        </button>
        <button type="button" className="ql-list" value="bullet" title="Aufzählung">
          <svg {...STROKE_ICON_PROPS}>
            <StrokePath d="M9 6h12" />
            <StrokePath d="M9 12h12" />
            <StrokePath d="M9 18h12" />
            <circle cx="4.5" cy="6" r="1" className="ql-fill" stroke="none" />
            <circle cx="4.5" cy="12" r="1" className="ql-fill" stroke="none" />
            <circle cx="4.5" cy="18" r="1" className="ql-fill" stroke="none" />
          </svg>
        </button>
        <button type="button" className="ql-indent" value="-1" title="Einzug verkleinern">
          <svg {...STROKE_ICON_PROPS}>
            <StrokePath d="M10 8h11" />
            <StrokePath d="M10 16h11" />
            <StrokePath d="M3 5h3" />
            <StrokePath d="M3 19h3" />
            <StrokePath d="m8 10-3 2 3 2" />
          </svg>
        </button>
        <button type="button" className="ql-indent" value="+1" title="Einzug vergrößern">
          <svg {...STROKE_ICON_PROPS}>
            <StrokePath d="M13 8h8" />
            <StrokePath d="M13 16h8" />
            <StrokePath d="M3 5h3" />
            <StrokePath d="M3 19h3" />
            <StrokePath d="m5 10 3 2-3 2" />
          </svg>
        </button>
      </span>
      <span className="ql-formats">
        <button type="button" className="ql-blockquote" title="Zitat">
          <svg {...STROKE_ICON_PROPS}>
            <StrokePath d="M4 6h16" />
            <StrokePath d="M4 11h10" />
            <path
              d="M6 17c0-2 1-3 3-3"
              className="ql-stroke"
              strokeWidth={2}
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button type="button" className="ql-code-block" title="Codeblock">
          <svg {...STROKE_ICON_PROPS}>
            <StrokePath d="m8 7-5 5 5 5" />
            <StrokePath d="m16 7 5 5-5 5" />
          </svg>
        </button>
        <button type="button" className="ql-link" title="Link">
          <svg {...STROKE_ICON_PROPS}>
            <path
              d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L11 4.93"
              className="ql-stroke"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 0 0 7.07 7.07L13 19.07"
              className="ql-stroke"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button type="button" className="ql-table" title="Tabelle einfügen">
          <svg {...STROKE_ICON_PROPS}>
            <rect x="3" y="4" width="18" height="16" rx="1" />
            <StrokePath d="M3 10h18" />
            <StrokePath d="M3 15h18" />
            <StrokePath d="M9 4v16" />
            <StrokePath d="M15 4v16" />
          </svg>
        </button>
        <button type="button" className="ql-clean" title="Formatierung entfernen">
          <svg {...STROKE_ICON_PROPS}>
            <StrokePath d="m7 21-4-4 11-11 4 4z" />
            <StrokePath d="m13 6 4 4" />
            <StrokePath d="M14 17h7" />
          </svg>
        </button>
      </span>
    </>
  );
}

interface DockedNoteToolbarProps {
  visible: boolean;
}

/**
 * Screen-space toolbar host docked top-center above the board. Rendered only
 * while a note is being edited; the inline editor connects to it by id.
 */
export function DockedNoteToolbar({ visible }: DockedNoteToolbarProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !visible) return;
    const onWheel = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener('wheel', onWheel);
    return () => el.removeEventListener('wheel', onWheel);
  }, [visible]);

  if (!visible) return null;
  return (
    <div
      ref={ref}
      id={NOTE_QUILL_TOOLBAR_ID}
      className="whiteboard-note-toolbar ql-toolbar ql-snow absolute left-1/2 top-14 z-30 -translate-x-1/2 rounded-lg border border-[var(--border)] shadow-lg backdrop-blur"
      style={{ maxWidth: 'calc(100% - 1.5rem)', touchAction: 'auto' }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <NoteQuillToolbarMarkup />
    </div>
  );
}

interface NoteQuillEditorProps {
  element: WhiteboardElement;
  onUpdate: (id: string, patch: WhiteboardPatch) => void;
  onCloseEdit: () => void;
  boxWidth: number;
  boxHeight: number;
}

/**
 * In-place rich text editor rendered inside the note element itself, styled
 * exactly like the final note display. Formats apply through the docked
 * toolbar (see NOTE_QUILL_TOOLBAR_ID) and changes save live while typing.
 */
export function NoteQuillEditor({
  element,
  onUpdate,
  onCloseEdit,
  boxWidth,
  boxHeight,
}: NoteQuillEditorProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const quillRef = useRef<ReactQuill | null>(null);
  const mountedAt = useRef(performance.now());
  const saveTimerRef = useRef<number | null>(null);
  const latestRef = useRef({ id: element.id, html: ensureHtml(element.text), onUpdate });
  const [draft, setDraft] = useState(() => ensureHtml(element.text));
  const { ref: fitRef, fontSize } = useFitFontSize(draft, boxWidth, boxHeight, true);

  latestRef.current = { id: element.id, html: latestRef.current.html, onUpdate };

  const scheduleSave = (html: string) => {
    latestRef.current.html = html;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      const { id, html: current, onUpdate: update } = latestRef.current;
      const clean = current.trim();
      update(id, { text: isEmptyHtml(clean) ? '' : clean });
    }, LIVE_SAVE_DEBOUNCE_MS);
  };

  useEffect(() => {
    quillRef.current?.focus();
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        const { id, html, onUpdate: update } = latestRef.current;
        const clean = html.trim();
        update(id, { text: isEmptyHtml(clean) ? '' : clean });
      }
    };
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

  const flushSave = () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      const { id, html, onUpdate: update } = latestRef.current;
      const clean = html.trim();
      update(id, { text: isEmptyHtml(clean) ? '' : clean });
    }
  };

  const closeEdit = () => {
    flushSave();
    onCloseEdit();
  };

  return (
    <div
      ref={wrapperRef}
      className="whiteboard-note-editor w-full"
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => {
        const related = e.relatedTarget as Element | null;
        if (wrapperRef.current?.contains(related)) return;
        if (related?.closest?.(`#${NOTE_QUILL_TOOLBAR_ID}`)) return;
        if (performance.now() - mountedAt.current < BLUR_GRACE_MS) {
          quillRef.current?.focus();
          return;
        }
        closeEdit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          closeEdit();
          return;
        }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          closeEdit();
        }
      }}
    >
      <div ref={fitRef as RefObject<HTMLDivElement>} style={{ fontSize }} className="w-full">
        <ReactQuill
          ref={quillRef}
          theme="snow"
          defaultValue={ensureHtml(element.text)}
          onChange={(value) => {
            setDraft(value);
            scheduleSave(value);
          }}
          modules={{
            toolbar: {
              container: `#${NOTE_QUILL_TOOLBAR_ID}`,
              handlers: quillModules.toolbar.handlers,
            },
          }}
          formats={quillFormats}
          placeholder="Notiz schreiben…"
        />
      </div>
    </div>
  );
}
