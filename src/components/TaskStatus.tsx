import { useState } from 'react';
import type { BingoGame } from '../../shared/types';
import type { Socket } from '../types';

interface TaskStatusProps {
  game: BingoGame;
  socket: Socket | null;
}

export function TaskStatus({ game, socket }: TaskStatusProps) {
  const [pendingTask, setPendingTask] = useState<{ id: string; action: 'confirm' | 'unconfirm' } | null>(null);
  const taskMap = new Map(game.tasks.map((t) => [t.id, t]));

  const taskStatus = game.tasks.map((task) => {
    const confirmedCell = game.players
      .flatMap((p) => p.board ?? [])
      .flat()
      .find((cell) => cell.taskId === task.id && cell.confirmedBy);
    return {
      task,
      confirmedBy: confirmedCell?.confirmedBy || null,
    };
  });

  const handleClick = (taskId: string, confirmedBy: string | null) => {
    if (game.status !== 'playing' || !socket) return;
    setPendingTask({ id: taskId, action: confirmedBy ? 'unconfirm' : 'confirm' });
  };

  const submit = () => {
    if (!pendingTask || !socket) return;
    if (pendingTask.action === 'confirm') {
      socket.emit('confirmTask', pendingTask.id);
    } else {
      socket.emit('unconfirmTask', pendingTask.id);
    }
    setPendingTask(null);
  };

  const pendingTaskData = pendingTask ? taskMap.get(pendingTask.id) : null;

  return (
    <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5 mb-8">
      <h2 className="text-xl font-semibold text-[var(--text-h)] mb-4">Aufgaben-Status</h2>
      <ul className="space-y-2">
        {taskStatus.length === 0 && <li className="text-slate-500 italic">Noch keine Aufgaben.</li>}
        {taskStatus.map(({ task, confirmedBy }) => (
          <li
            key={task.id}
            onClick={() => handleClick(task.id, confirmedBy)}
            className={`flex items-center justify-between px-3 py-2 rounded border border-[var(--border)] cursor-pointer hover:bg-slate-800/50 transition ${
              confirmedBy ? 'bg-[var(--accent-dim)]' : 'bg-slate-900/50'
            }`}
          >
            <span className={confirmedBy ? 'text-[var(--accent)]' : 'text-[var(--text-h)]'}>{task.text}</span>
            <span className={`text-sm font-semibold ${confirmedBy ? 'text-[var(--accent)]' : 'text-slate-500'}`}>
              {confirmedBy ? `✓ ${confirmedBy}` : 'Offen'}
            </span>
          </li>
        ))}
      </ul>

      {pendingTaskData && pendingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-xl font-semibold text-[var(--text-h)] mb-2">
              {pendingTask.action === 'confirm' ? 'Aufgabe bestätigen' : 'Bestätigung entfernen'}
            </h3>
            <p className="text-slate-300 mb-6">
              Soll <span className="text-[var(--text-h)] font-medium">{pendingTaskData.text}</span>{' '}
              {pendingTask.action === 'confirm'
                ? 'als erledigt markiert werden? Dies gilt für alle Spieler.'
                : 'nicht mehr als erledigt gelten? Dies gilt für alle Spieler.'}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setPendingTask(null)}
                className="px-4 py-2 rounded border border-[var(--border)] text-[var(--text-h)] hover:bg-slate-800 transition"
              >
                Abbrechen
              </button>
              <button
                onClick={submit}
                className={`px-4 py-2 rounded font-semibold transition ${
                  pendingTask.action === 'confirm'
                    ? 'bg-[var(--accent)] text-slate-900 hover:bg-green-400'
                    : 'bg-[var(--danger)] text-white hover:bg-red-400'
                }`}
              >
                {pendingTask.action === 'confirm' ? 'Erledigt' : 'Entfernen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
