import { useCallback, useEffect, useState } from 'react';
import { WhiteboardBoard } from '../components/whiteboard/WhiteboardBoard';
import { WhiteboardToolbar } from '../components/whiteboard/WhiteboardToolbar';
import {
  NOTE_COLORS,
  NO_FILL,
  STROKE_WIDTHS,
  type WhiteboardTool,
} from '../components/whiteboard/whiteboardShared';
import { useWhiteboard } from '../hooks/useWhiteboard';
import type { SafeUser, WhiteboardPatch } from '../../shared/types';

interface WhiteboardProps {
  user: SafeUser | null;
}

export function Whiteboard({ user }: WhiteboardProps) {
  const [tool, setTool] = useState<WhiteboardTool>('select');
  const [color, setColor] = useState<string>(NOTE_COLORS[0]);
  const [fillColor, setFillColor] = useState<string>(NO_FILL);
  const [strokeWidth, setStrokeWidth] = useState<number>(STROKE_WIDTHS[0]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const {
    elements,
    createElement,
    applyPatchLocal,
    updateElement,
    removeElement,
    beginLocalEdit,
    endLocalEdit,
  } = useWhiteboard(user);

  // Deselect when the element disappears (e.g. removed by another user).
  useEffect(() => {
    if (selectedId && !elements.some((e) => e.id === selectedId)) {
      setSelectedId(null);
    }
  }, [elements, selectedId]);

  const applyToSelected = useCallback(
    (patch: WhiteboardPatch) => {
      if (selectedId) updateElement(selectedId, patch);
    },
    [selectedId, updateElement]
  );

  const selectedElement =
    elements.find(
      (e) => e.id === selectedId && (e.type === 'note' || e.type === 'shape' || e.type === 'stroke')
    ) ?? null;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <WhiteboardToolbar
        tool={tool}
        onToolChange={setTool}
        color={color}
        onColorChange={setColor}
        fillColor={fillColor}
        onFillColorChange={setFillColor}
        strokeWidth={strokeWidth}
        onStrokeWidthChange={setStrokeWidth}
        selectedElement={selectedElement}
        onUpdateSelected={applyToSelected}
      />
      <WhiteboardBoard
        user={user!}
        elements={elements}
        tool={tool}
        color={color}
        fillColor={fillColor}
        strokeWidth={strokeWidth}
        onToolChange={setTool}
        onSelectedElementId={setSelectedId}
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
