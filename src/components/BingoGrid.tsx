import { useState } from 'react';
import type { BingoGame } from '../../shared/types';
import type { Socket } from '../types';

interface BingoGridProps {
  game: BingoGame;
  socket: Socket | null;
  playerId: string | null;
}

export function BingoGrid({ game, socket, playerId }: BingoGridProps) {
  const player = game.players.find((p) => p.id === playerId);
  const board = player?.board;
  const [draggedCell, setDraggedCell] = useState<{ r: number; c: number } | null>(null);

  const taskMap = new Map(game.tasks.map((t) => [t.id, t]));

  const swap = (r: number, c: number) => {
    if (!draggedCell || !board || !socket || !playerId) return;
    const newBoard = board.map((row) => row.map((cell) => ({ ...cell })));
    const temp = newBoard[draggedCell.r][draggedCell.c];
    newBoard[draggedCell.r][draggedCell.c] = newBoard[r][c];
    newBoard[r][c] = temp;
    socket.emit('updateBoard', newBoard);
    setDraggedCell(null);
  };

  const confirm = (taskId: string | null) => {
    if (!taskId || !socket) return;
    socket.emit('confirmTask', taskId);
  };

  if (!board) return null;

  return (
    <div className="overflow-auto">
      <div
        className="grid gap-2 mx-auto"
        style={{
          gridTemplateColumns: `repeat(${board.length}, minmax(0, 1fr))`,
        }}
      >
        {board.map((row, r) =>
          row.map((cell, c) => {
            const task = cell.taskId ? taskMap.get(cell.taskId) : null;
            const isDragging = draggedCell?.r === r && draggedCell?.c === c;
            return (
              <div
                key={`${r}-${c}`}
                draggable={!cell.confirmedBy}
                onDragStart={() => !cell.confirmedBy && setDraggedCell({ r, c })}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => swap(r, c)}
                onClick={() => confirm(cell.taskId)}
                className={`
                  relative p-3 min-h-[110px] rounded-xl border flex flex-col items-center justify-center text-center
                  transition select-none
                  ${cell.confirmedBy ? 'bg-[var(--accent-dim)] border-[var(--accent)]' : 'bg-slate-900 border-[var(--border)] cursor-move'}
                  ${isDragging ? 'opacity-50' : 'opacity-100'}
                `}
              >
                <span className={`text-sm leading-tight ${cell.confirmedBy ? 'text-[var(--accent)]' : 'text-[var(--text-h)]'}`}>
                  {task?.text || '?'}
                </span>
                {cell.confirmedBy && (
                  <span className="text-xs text-[var(--accent)] mt-2 font-semibold">
                    ✓ {cell.confirmedBy}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
      <p className="text-center text-slate-500 text-sm mt-4">
        Zellen per Drag & Drop tauschen. Zum Bestätigen auf eine Zelle klicken.
      </p>
    </div>
  );
}
