import { useCallback, useState } from 'react';
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

  // The selection is only meaningful while the element still exists
  // (e.g. it may be removed by another user); derive instead of resetting.
  const effectiveSelectedId =
    selectedId !== null && elements.some((e) => e.id === selectedId) ? selectedId : null;

  const applyToSelected = useCallback(
    (patch: WhiteboardPatch) => {
      if (effectiveSelectedId) updateElement(effectiveSelectedId, patch);
    },
    [effectiveSelectedId, updateElement]
  );

  const selectedElement =
    elements.find(
      (e) =>
        e.id === effectiveSelectedId &&
        (e.type === 'note' || e.type === 'text' || e.type === 'shape' || e.type === 'stroke')
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
