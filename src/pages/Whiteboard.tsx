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
    createElement,
    applyPatchLocal,
    updateElement,
    removeElement,
    beginLocalEdit,
    endLocalEdit,
  } = useWhiteboard(user);

  return (
    <div className="relative h-full w-full overflow-hidden">
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
  );
}
