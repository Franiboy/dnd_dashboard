import { useState, type ReactNode } from 'react';
import type { BingoGame, Cell, Task } from '../../shared/types';
import type { Socket } from '../types';
import { useI18n } from '../hooks/useI18n';
import { ConfirmDialog } from './ConfirmDialog';
import { Modal } from './Modal';

interface BingoGridProps {
  game: BingoGame;
  socket: Socket | null;
  playerId: string | null;
  className?: string;
  controls?: ReactNode;
  availableTasks?: Task[];
}

export function BingoGrid({
  game,
  socket,
  playerId,
  className,
  controls,
  availableTasks,
}: BingoGridProps) {
  const { t } = useI18n();
  const player = game.players.find((p) => p.id === playerId);
  const board = player?.board;
  const [draggedCell, setDraggedCell] = useState<{ r: number; c: number } | null>(null);
  const [isOverDelete, setIsOverDelete] = useState(false);
  const [pendingTask, setPendingTask] = useState<{
    id: string;
    action: 'confirm' | 'unconfirm';
  } | null>(null);
  const [fillingCell, setFillingCell] = useState<{ r: number; c: number } | null>(null);

  // The delete target only highlights while a card is actually being dragged.
  const isOverDeleteVisible = draggedCell !== null && isOverDelete;
  const taskMap = new Map(game.tasks.map((t) => [t.id, t]));
  // Boards are editable in setup and, for late joiners, during the running
  // game until they are locked.
  const canEdit = !player?.locked && (game.status === 'setup' || game.status === 'playing');

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

  const handleDeleteDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsOverDelete(false);
    if (!canEdit || !board || !draggedCell) {
      setDraggedCell(null);
      return;
    }
    const newBoard = board.map((row) => row.map((cell) => ({ ...cell })));
    newBoard[draggedCell.r][draggedCell.c] = {
      ...newBoard[draggedCell.r][draggedCell.c],
      taskId: null,
    };
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

  const placeTask = (taskId: string) => {
    setFillingCell(null);
    if (!canEdit || !board || !socket) return;
    const task = taskMap.get(taskId);
    if (task?.isPrivate && (!player?.userId || !task.assignedTo?.includes(player.userId))) return;
    const { r, c } = fillingCell!;
    const newBoard = board.map((row) => row.map((cell) => ({ ...cell })));
    // Remove the task from any other cell to avoid duplicates within the board
    for (let i = 0; i < newBoard.length; i++) {
      for (let j = 0; j < newBoard[i].length; j++) {
        if (newBoard[i][j].taskId === taskId) {
          newBoard[i][j] = { ...newBoard[i][j], taskId: null };
        }
      }
    }
    newBoard[r][c] = { ...newBoard[r][c], taskId };
    updateBoard(newBoard);
  };

  const handleCellClick = (taskId: string | null, isConfirmed: boolean, r: number, c: number) => {
    if (canEdit && !taskId) {
      setFillingCell({ r, c });
      return;
    }
    openTaskAction(taskId, isConfirmed);
  };

  const submit = () => {
    if (!pendingTask || !socket) return;
    if (pendingTask.action === 'confirm' && player?.status === 'bingo') {
      setPendingTask(null);
      return;
    }
    // DM-pool tasks are marked on the own board only; player tasks are
    // confirmed globally.
    if (pendingTaskData?.audience === 'dm') {
      socket.emit(
        pendingTask.action === 'confirm' ? 'confirmOwnTask' : 'unconfirmOwnTask',
        pendingTask.id
      );
    } else {
      socket.emit(
        pendingTask.action === 'confirm' ? 'confirmTask' : 'unconfirmTask',
        pendingTask.id
      );
    }
    setPendingTask(null);
  };

  const cellConfirmed = (taskId: string) => {
    if (!board) return true;
    return board.every((row) => row.every((cell) => cell.taskId !== taskId || cell.confirmedBy));
  };

  if (!board)
    return <div className="text-slate-500 text-center">{t('bingo.grid.unavailable')}</div>;

  const pendingTaskData = pendingTask ? taskMap.get(pendingTask.id) : null;

  return (
    <div className={`flex flex-col ${className || ''}`}>
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        <div className="w-full max-h-full aspect-square">
          <div
            className="grid gap-1.5 sm:gap-2 w-full h-full p-1"
            style={{
              gridTemplateColumns: `repeat(${board.length}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${board.length}, minmax(0, 1fr))`,
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
                    onClick={() => handleCellClick(cell.taskId, !!cell.confirmedBy, r, c)}
                    title={task?.text || (canEdit && isEmpty ? t('bingo.grid.emptyCell') : '')}
                    className={`
                      relative p-1 sm:p-2 min-h-0 min-w-0 overflow-hidden rounded-lg sm:rounded-xl border flex flex-col items-center justify-center text-center gap-0.5 sm:gap-1
                      transition select-none break-words
                      ${cell.confirmedBy ? 'bg-[var(--accent-dim)] border-[var(--accent)]' : 'bg-slate-900 border-[var(--border)]'}
                      ${canEdit ? 'cursor-move' : 'cursor-default'}
                      ${isDragging ? 'opacity-50' : 'opacity-100'}
                    `}
                  >
                    {task ? (
                      <span
                        className={`text-xs sm:text-sm leading-tight ${cell.confirmedBy ? 'text-[var(--accent)]' : 'text-[var(--text-h)]'}`}
                        style={{
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {task.text}
                      </span>
                    ) : (
                      <span className="text-slate-600 text-xs sm:text-sm">
                        {canEdit ? '+' : '?'}
                      </span>
                    )}
                    {cell.confirmedBy && (
                      <span className="text-[10px] sm:text-xs text-[var(--accent)] mt-0.5 font-semibold truncate max-w-full">
                        ✓ {cell.confirmedBy}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
      <div className="shrink-0 flex flex-col justify-between mt-2 sm:mt-3 gap-2">
        {canEdit && draggedCell ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsOverDelete(true);
            }}
            onDragLeave={() => setIsOverDelete(false)}
            onDrop={handleDeleteDrop}
            className={`h-14 sm:h-16 rounded-xl border-2 border-dashed flex items-center justify-center text-xs sm:text-sm transition select-none
              ${isOverDeleteVisible ? 'bg-red-900/40 border-red-500 text-red-500' : 'bg-red-900/20 border-[var(--danger)] text-[var(--danger)]'}`}
          >
            {t('bingo.grid.dragToRemove')}
          </div>
        ) : (
          <>
            <p
              className="text-center text-slate-500 text-xs leading-tight px-2"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {canEdit
                ? t('bingo.grid.editInstructions')
                : game.status === 'setup' && player?.locked
                  ? t('bingo.grid.lockedDuringSetup')
                  : player?.status === 'lobby'
                    ? t('bingo.grid.fillAndLock')
                    : t('bingo.grid.confirmInstructions')}
            </p>
            {controls && (
              <div className="flex flex-col items-center gap-2 shrink-0">{controls}</div>
            )}
          </>
        )}
      </div>

      {pendingTaskData && pendingTask && (
        <ConfirmDialog
          title={
            pendingTask.action === 'confirm'
              ? t('bingo.tasks.confirmTitle')
              : t('bingo.tasks.removeConfirmationTitle')
          }
          confirmLabel={
            pendingTask.action === 'confirm' ? t('bingo.tasks.done') : t('bingo.tasks.remove')
          }
          variant={pendingTask.action === 'confirm' ? 'accent' : 'danger'}
          onConfirm={submit}
          onCancel={() => setPendingTask(null)}
        >
          <p>
            {t(
              pendingTask.action === 'confirm'
                ? 'bingo.tasks.confirmQuestionStart'
                : 'bingo.tasks.unconfirmQuestionStart'
            )}
            <span className="text-[var(--text-h)] font-medium">{pendingTaskData.text}</span>
            {t(
              pendingTask.action === 'confirm'
                ? 'bingo.tasks.confirmQuestionEnd'
                : 'bingo.tasks.unconfirmQuestionEnd',
              {
                scope: t(
                  pendingTaskData.audience === 'dm'
                    ? 'bingo.tasks.ownBoardScope'
                    : 'bingo.tasks.allPlayersScope'
                ),
              }
            )}
          </p>
        </ConfirmDialog>
      )}

      {fillingCell && (
        <TaskSelectModal
          tasks={availableTasks ?? []}
          placedTaskIds={
            new Set(
              board
                ?.flat()
                .filter((cell) => cell.taskId)
                .map((cell) => cell.taskId!) ?? []
            )
          }
          onSelect={placeTask}
          onClose={() => setFillingCell(null)}
        />
      )}
    </div>
  );
}

function TaskSelectModal({
  tasks,
  placedTaskIds,
  onSelect,
  onClose,
}: {
  tasks: Task[];
  placedTaskIds: Set<string>;
  onSelect: (taskId: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const available = tasks.filter((task) => !placedTaskIds.has(task.id));

  return (
    <Modal isOpen onClose={onClose} title={t('bingo.grid.selectTask')}>
      {available.length === 0 ? (
        <p className="text-slate-500">{t('bingo.grid.noAvailableTasks')}</p>
      ) : (
        <ul className="max-h-80 space-y-2 overflow-auto">
          {available.map((task) => (
            <li key={task.id}>
              <button
                type="button"
                onClick={() => onSelect(task.id)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded border border-[var(--border)] bg-slate-900/50 text-left text-[var(--text-h)] hover:bg-slate-800 transition"
              >
                <span className="min-w-0 break-words">{task.text}</span>
                {task.isPrivate && (
                  <span
                    className="shrink-0 text-xs"
                    title={t('bingo.grid.privateTask')}
                    aria-label={t('bingo.grid.privateTask')}
                  >
                    🔒
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
