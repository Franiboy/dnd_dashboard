import { useEffect, useState } from 'react';
import type { BingoGame, SafeUser } from '../../shared/types';
import type { Socket } from '../types';
import { useApi } from '../hooks/useApi';
import { Loading } from './Loading';
import { ConfirmDialog } from './ConfirmDialog';
import { Toggle } from './Toggle';
import { UserInline } from './UserInline';

interface TaskStatusProps {
  game: BingoGame;
  socket: Socket | null;
}

export function TaskStatus({ game, socket }: TaskStatusProps) {
  const { request } = useApi();
  const [pendingTask, setPendingTask] = useState<{ id: string; action: 'confirm' | 'unconfirm' } | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const taskMap = new Map(game.tasks.map((t) => [t.id, t]));

  useEffect(() => {
    setUsersLoading(true);
    request<SafeUser[]>('/api/admin/users').then(({ data }) => {
      setUsers(data ?? []);
      setUsersLoading(false);
    });
  }, [request]);

  const taskStatus = game.tasks
    .filter((task) => showHidden || !task.isPrivate)
    .map((task) => {
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
    <div className="h-full flex flex-col">
      {usersLoading && (
        <div className="mb-2">
          <Loading text="Benutzer laden..." size="sm" />
        </div>
      )}
      <ul className="flex-1 min-h-0 space-y-2 overflow-auto">
        {taskStatus.length === 0 && <li className="text-slate-500 italic">Noch keine Aufgaben.</li>}
        {taskStatus.map(({ task, confirmedBy }) => (
          <li
            key={task.id}
            onClick={() => handleClick(task.id, confirmedBy)}
            className={`flex items-center justify-between px-3 py-2 rounded border border-[var(--border)] cursor-pointer hover:bg-slate-800/50 transition ${
              confirmedBy ? 'bg-[var(--accent-dim)]' : 'bg-slate-900/50'
            }`}
          >
            <span className={confirmedBy ? 'text-[var(--accent)]' : 'text-[var(--text-h)]'}>
              {task.text}
              {task.isPrivate && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs text-slate-400">
                  <span>🔒</span>
                  <UserInline users={users} userIds={task.assignedTo} />
                </span>
              )}
            </span>
            <span className={`text-sm font-semibold ${confirmedBy ? 'text-[var(--accent)]' : 'text-slate-500'}`}>
              {confirmedBy ? `✓ ${confirmedBy}` : 'Offen'}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-2">
        <Toggle
          checked={showHidden}
          onChange={setShowHidden}
          label="Versteckte Aufgaben anzeigen"
        />
      </div>

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
