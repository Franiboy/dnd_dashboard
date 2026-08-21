import { useState } from 'react';
import { WhiteboardBoard } from '../components/whiteboard/WhiteboardBoard';
import { WhiteboardToolbar } from '../components/whiteboard/WhiteboardToolbar';
import { NOTE_COLORS, type WhiteboardTool } from '../components/whiteboard/whiteboardShared';
import { useWhiteboard } from '../hooks/useWhiteboard';
import type { SafeUser } from '../../shared/types';

interface WhiteboardProps {
  user: SafeUser | null;
}

export function Whiteboard({ user }: WhiteboardProps) {
  const [tool, setTool] = useState<WhiteboardTool>('select');
  const [color, setColor] = useState<string>(NOTE_COLORS[0]);
  const {
    elements,
    connected,
    createElement,
    applyPatchLocal,
    updateElement,
    removeElement,
    beginLocalEdit,
    endLocalEdit,
  } = useWhiteboard(user);

  return (
    <div className="flex h-full flex-col p-4 sm:p-6">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-h)]">Whiteboard</h1>
          <p className="text-sm text-slate-400">
            Notizen & Aufgaben – oben öffentlich für alle, darunter dein privater Bereich.
          </p>
        </div>
        <span
          className={`hidden shrink-0 rounded-full px-3 py-1 text-xs font-semibold sm:block ${
            connected
              ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
              : 'bg-[var(--warning)]/15 text-[var(--warning)]'
          }`}
        >
          {connected ? 'Live verbunden' : 'Verbinde…'}
        </span>
      </div>

      <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)]">
        <WhiteboardToolbar
          tool={tool}
          onToolChange={setTool}
          color={color}
          onColorChange={setColor}
        />
        <WhiteboardBoard
          user={user!}
          elements={elements}
          tool={tool}
          color={color}
          onToolChange={setTool}
          createElement={createElement}
          applyPatchLocal={applyPatchLocal}
          updateElement={updateElement}
          removeElement={removeElement}
          beginLocalEdit={beginLocalEdit}
          endLocalEdit={endLocalEdit}
        />
      </div>
    </div>
  );
}
