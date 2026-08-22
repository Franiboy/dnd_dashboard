import { useCallback, useEffect, useState } from 'react';
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
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const {
    elements,
    createElement,
    applyPatchLocal,
    updateElement,
    removeElement,
    beginLocalEdit,
    endLocalEdit,
  } = useWhiteboard(user);

  // Deselect when the note disappears (e.g. removed by another user).
  useEffect(() => {
    if (selectedNoteId && !elements.some((e) => e.id === selectedNoteId)) {
      setSelectedNoteId(null);
    }
  }, [elements, selectedNoteId]);

  const handleNoteColorChange = useCallback(
    (c: string) => {
      setColor(c);
      if (selectedNoteId) updateElement(selectedNoteId, { color: c });
    },
    [selectedNoteId, updateElement]
  );

  const selectedNote = elements.find((e) => e.id === selectedNoteId && e.type === 'note') ?? null;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <WhiteboardToolbar
        tool={tool}
        onToolChange={setTool}
        color={color}
        onColorChange={setColor}
        selectedNote={selectedNote}
        onNoteColorChange={handleNoteColorChange}
      />
      <WhiteboardBoard
        user={user!}
        elements={elements}
        tool={tool}
        color={color}
        onToolChange={setTool}
        onSelectedNoteId={setSelectedNoteId}
        createElement={createElement}
        applyPatchLocal={applyPatchLocal}
        updateElement={updateElement}
        removeElement={removeElement}
        beginLocalEdit={beginLocalEdit}
        endLocalEdit={endLocalEdit}
      />
    </div>
  );
}
