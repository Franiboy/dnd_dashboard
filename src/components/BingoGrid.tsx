import { useState } from 'react';
import type { BingoGame, Cell } from '../../shared/types';
import type { Socket } from '../types';
import { ConfirmDialog } from './ConfirmDialog';

interface BingoGridProps {
  game: BingoGame;
  socket: Socket | null;
  playerId: string | null;
  className?: string;
}

export function BingoGrid({ game, socket, playerId, className }: BingoGridProps) {
  const player = game.players.find((p) => p.id === playerId);
  const board = player?.board;
  const [draggedCell, setDraggedCell] = useState<{ r: number; c: number } | null>(null);
  const [pendingTask, setPendingTask] = useState<{ id: string; action: 'confirm' | 'unconfirm' } | null>(null);

  const taskMap = new Map(game.tasks.map((t) => [t.id, t]));
  const isDrafting = game.status === 'setup';
  const canEdit = isDrafting && !player?.locked;

  const updateBoard = (newBoard: Cell[][]) => {
    if (!socket || !playerId) return;
    socket.emit('updateBoard', newBoard);
  };

  const handleDrop = (e: React.DragEvent, r: number, c: number) => {
    e.preventDefault();
    if (!canEdit || !board) return;
    const raw = e.dataTransfer.getData('text/plain');
    if (!raw) return;

    let payload: { type: string; taskId?: string; r?: number; c?: number } | null = null;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { type: 'task', taskId: raw };
    }

    const newBoard = board.map((row) => row.map((cell) => ({ ...cell })));

    if (payload?.type === 'task' && payload.taskId) {
      const taskId = payload.taskId;
      const task = taskMap.get(taskId);
      if (task?.isPrivate && (!player?.userId || !task.assignedTo?.includes(player.userId))) {
        setDraggedCell(null);
        return;
      }
      // Remove the task from any other cell to avoid duplicates within the board
      for (let i = 0; i < newBoard.length; i++) {
        for (let j = 0; j < newBoard[i].length; j++) {
          if (newBoard[i][j].taskId === taskId) {
            newBoard[i][j] = { ...newBoard[i][j], taskId: null };
          }
        }
      }
      newBoard[r][c] = { ...newBoard[r][c], taskId };
    } else if (payload?.type === 'cell' && draggedCell) {
      const { r: sr, c: sc } = draggedCell;
      if (sr === r && sc === c) {
        setDraggedCell(null);
        return;
      }
      const temp = newBoard[sr][sc];
      newBoard[sr][sc] = newBoard[r][c];
      newBoard[r][c] = temp;
    }

    updateBoard(newBoard);
    setDraggedCell(null);
  };

  const openTaskAction = (taskId: string | null, isConfirmed: boolean) => {
    if (!taskId || game.status !== 'playing') return;
    if (isConfirmed) {
      setPendingTask({ id: taskId, action: 'unconfirm' });
    } else {
      if (player?.status === 'bingo' || cellConfirmed(taskId)) return;
      setPendingTask({ id: taskId, action: 'confirm' });
    }
  };

  const submit = () => {
    if (!pendingTask || !socket) return;
    if (pendingTask.action === 'confirm' && player?.status === 'bingo') {
      setPendingTask(null);
      return;
    }
    if (pendingTask.action === 'confirm') {
      socket.emit('confirmTask', pendingTask.id);
    } else {
      socket.emit('unconfirmTask', pendingTask.id);
    }
    setPendingTask(null);
  };

  const cellConfirmed = (taskId: string) => {
    if (!board) return true;
    return board.every((row) => row.every((cell) => cell.taskId !== taskId || cell.confirmedBy));
  };

  if (!board) return <div className="text-slate-500 text-center">Kein Board verfügbar.</div>;

  const pendingTaskData = pendingTask ? taskMap.get(pendingTask.id) : null;

  return (
    <div className={`flex flex-col ${className || ''}`}>
      <div
        className="grid gap-2 mx-auto flex-1 min-h-0 overflow-auto content-start items-start"
        style={{
          gridTemplateColumns: `repeat(${board.length}, minmax(0, 1fr))`,
        }}
      >
        {board.map((row, r) =>
          row.map((cell, c) => {
            const task = cell.taskId ? taskMap.get(cell.taskId) : null;
            const isDragging = draggedCell?.r === r && draggedCell?.c === c;
            const isEmpty = !cell.taskId;
            return (
              <div
                key={`${r}-${c}`}
                draggable={canEdit && !isEmpty}
                onDragStart={(e) => {
                  if (!canEdit || isEmpty) return;
                  e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'cell', r, c }));
                  setDraggedCell({ r, c });
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDrop(e, r, c)}
                onDragEnd={() => setDraggedCell(null)}
                onClick={() => openTaskAction(cell.taskId, !!cell.confirmedBy)}
                title={task?.text || (canEdit && isEmpty ? 'Leeres Feld' : '')}
                className={`
                  relative p-3 aspect-square min-h-0 overflow-hidden rounded-xl border flex flex-col items-center justify-center text-center gap-2
                  transition select-none break-words
                  ${cell.confirmedBy ? 'bg-[var(--accent-dim)] border-[var(--accent)]' : 'bg-slate-900 border-[var(--border)]'}
                  ${canEdit ? 'cursor-move' : 'cursor-default'}
                  ${isDragging ? 'opacity-50' : 'opacity-100'}
                `}
              >
                {task ? (
                  <span className={`text-sm leading-tight ${cell.confirmedBy ? 'text-[var(--accent)]' : 'text-[var(--text-h)]'}`}>
                    {task.text}
                  </span>
                ) : (
                  <span className="text-slate-600 text-sm">{canEdit ? '+' : '?'}</span>
                )}
                {cell.confirmedBy && (
                  <span className="text-xs text-[var(--accent)] mt-1 font-semibold">
                    ✓ {cell.confirmedBy}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
      <p className="text-center text-slate-500 text-sm mt-4">
        {canEdit
          ? 'Ziehe Aufgaben per Drag & Drop auf die Felder. Ziehe Felder, um sie zu tauschen.'
          : game.status === 'setup' && player?.locked
          ? 'Board ist eingelockt. Warte auf Spielstart.'
          : 'Zum Bestätigen auf eine Zelle klicken. Erneut klicken, um die Bestätigung zu entfernen.'}
      </p>

      {pendingTaskData && pendingTask && (
        <ConfirmDialog
          title={pendingTask.action === 'confirm' ? 'Aufgabe bestätigen' : 'Bestätigung entfernen'}
          confirmLabel={pendingTask.action === 'confirm' ? 'Erledigt' : 'Entfernen'}
          variant={pendingTask.action === 'confirm' ? 'accent' : 'danger'}
          onConfirm={submit}
          onCancel={() => setPendingTask(null)}
        >
          <p>
            Soll <span className="text-[var(--text-h)] font-medium">{pendingTaskData.text}</span>{' '}
            {pendingTask.action === 'confirm'
              ? 'als erledigt markiert werden? Dies gilt für alle Spieler.'
              : 'nicht mehr als erledigt gelten? Dies gilt für alle Spieler.'}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
