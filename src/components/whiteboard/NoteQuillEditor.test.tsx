import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Quill } from 'react-quill-new';
import type { WhiteboardElement } from '../../../shared/types';
import { NOTE_QUILL_TOOLBAR_ID, NoteQuillEditor } from './NoteQuillEditor';
import { WhiteboardElementView } from './WhiteboardElementView';

// Quill's mount focus reads layout metrics that jsdom does not implement.
beforeAll(() => {
  const rect = {
    width: 200,
    height: 150,
    top: 0,
    left: 0,
    right: 200,
    bottom: 150,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect);
  // jsdom does not implement Range metrics at all.
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { value: () => rect });
});

const noteWithText = (text: string): WhiteboardElement => ({
  id: 'note-1',
  type: 'note',
  zone: 'public',
  ownerId: 'user-1',
  ownerName: 'Alice',
  x: 0,
  y: 0,
  x2: null,
  y2: null,
  width: 200,
  height: 150,
  color: '#facc15',
  text,
  description: null,
  status: null,
  url: null,
  fromId: null,
  toId: null,
  shapeKind: null,
  fillColor: null,
  strokeWidth: 2,
  points: null,
  zIndex: 0,
  locked: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

/** Renders the docked toolbar host Quill needs plus the editor under test. */
function EditorHarness({ children }: { children: ReactNode }) {
  return (
    <div>
      <div id={NOTE_QUILL_TOOLBAR_ID} />
      {children}
    </div>
  );
}

describe('NoteQuillEditor', () => {
  it('saves real editor HTML so list markers survive into display view', async () => {
    const onUpdate = vi.fn();
    render(
      <EditorHarness>
        <NoteQuillEditor
          element={noteWithText('<p>Alt</p>')}
          onUpdate={onUpdate}
          onCloseEdit={vi.fn()}
          boxWidth={184}
          boxHeight={134}
        />
      </EditorHarness>
    );

    // The Quill instance hangs off the container node it was mounted on.
    const container = document.querySelector('.whiteboard-note-editor .ql-container');
    expect(container).not.toBeNull();
    const quill = Quill.find(container as Element) as Quill | null;
    expect(quill).not.toBeNull();

    (quill as Quill).setContents([
      { insert: 'Punkt eins' },
      { insert: '\nPunkt zwei', attributes: { list: 'bullet' } },
      { insert: '\nEins', attributes: { list: 'ordered' } },
    ]);

    // The live-saving debounce persists the changed HTML shortly after typing.
    await waitFor(
      () => {
        const calls = onUpdate.mock.calls.filter(([, patch]) => 'text' in patch);
        expect(calls.length).toBeGreaterThan(0);
        const saved = calls.at(-1)?.[1].text as string;
        expect(saved).toContain('data-list="bullet"');
        expect(saved).toContain('data-list="ordered"');
        expect(saved).toContain('class="ql-ui"');
      },
      { timeout: 2000 }
    );
  });
});

describe('WhiteboardElementView note display parity', () => {
  it('renders saved notes inside the snow theme context like the editor', () => {
    const noop = vi.fn();
    render(
      <WhiteboardElementView
        element={noteWithText(
          '<ul><li data-list="bullet"><span class="ql-ui"></span>Punkt</li></ul>'
        )}
        selected={false}
        editing={false}
        dragging={false}
        cropping={false}
        cameraScale={1}
        interactive
        hideOverlayControls={false}
        onPointerDown={noop}
        onStartResize={noop}
        onRequestEdit={noop}
        onCloseEdit={noop}
        onUpdate={noop}
        onDelete={noop}
        onCropApply={noop}
        onCropCancel={noop}
        canBringForward
        canSendBackward
        onBringForward={noop}
        onSendBackward={noop}
      />
    );

    const content = document.querySelector('.whiteboard-note-content');
    expect(content).not.toBeNull();
    // Without the ql-snow context the display loses heading sizes, quote
    // borders, code backgrounds and link styling that the editor applies.
    expect(content?.classList.contains('ql-snow')).toBe(true);
    const editor = content?.querySelector('.ql-editor');
    expect(editor?.querySelector('li[data-list="bullet"] .ql-ui')).not.toBeNull();
  });
});
