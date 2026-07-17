import { useEffect, useState } from 'react';
import type { BingoGame, SafeUser } from '../../shared/types';
import type { Socket } from '../types';
import { useApi } from '../hooks/useApi';
import { Toggle } from './Toggle';
import { UserCheckboxList } from './UserCheckboxList';
import { UserInline } from './UserInline';

interface TaskPoolProps {
  game: BingoGame;
  socket: Socket | null;
  isSetup: boolean;
  className?: string;
  listClassName?: string;
  currentUser?: SafeUser | null;
}

export function TaskPool({ game, socket, isSetup, className, listClassName, currentUser }: TaskPoolProps) {
  const { request } = useApi();
  const [text, setText] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [assignedTo, setAssignedTo] = useState<string[]>([]);
  const [users, setUsers] = useState<SafeUser[]>([]);
  const isAdmin = !!currentUser?.isAdmin;
  const ownerId = currentUser?.id;

  useEffect(() => {
    if (!isAdmin) return;
    request<{ users: SafeUser[] }>('/api/admin/users').then(({ data }) => {
      if (data?.users) setUsers(data.users);
    });
  }, [isAdmin, request]);

  const add = () => {
    if (!text.trim() || !socket) return;
    if (isPrivate && (!ownerId || assignedTo.length === 0)) return;
    socket.emit('addTask', {
      text: text.trim(),
      isPrivate,
      assignedTo: isPrivate ? assignedTo : [],
    });
    setText('');
    setIsPrivate(false);
    setAssignedTo([]);
  };

  const remove = (id: string) => {
    socket?.emit('removeTask', id);
  };

  return (
    <div className={`bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5 ${className || ''}`}>
      <h2 className="text-xl font-semibold text-[var(--text-h)] mb-4">Aufgaben-Pool</h2>
      {isSetup && (
        <div className="flex flex-col gap-3 mb-4">
          <div className="flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="Neue Aufgabe..."
              className="flex-1 px-3 py-2 rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
            <button
              onClick={add}
              disabled={!text.trim() || (isPrivate && assignedTo.length === 0)}
              className="px-4 py-2 rounded bg-[var(--accent)] text-slate-900 font-semibold hover:bg-green-400 transition disabled:opacity-50"
            >
              Hinzufügen
            </button>
          </div>
          {isAdmin && (
            <div className="flex flex-col gap-2 p-3 rounded bg-slate-900/30 border border-[var(--border)]">
              <Toggle
                checked={isPrivate}
                onChange={(checked) => {
                  setIsPrivate(checked);
                  setAssignedTo(checked && ownerId ? [ownerId] : []);
                }}
                label="Private Aufgabe"
              />
              {isPrivate && ownerId && (
                <UserCheckboxList
                  users={users}
                  selected={assignedTo}
                  onChange={setAssignedTo}
                  disabledIds={[ownerId]}
                  title="Zugewiesen an (mehrere möglich):"
                  emptyMessage="Keine Benutzer geladen."
                />
              )}
            </div>
          )}
        </div>
      )}
      <ul className={`space-y-2 overflow-auto ${listClassName || 'max-h-64'}`}>
        {game.tasks.length === 0 && <li className="text-slate-500 italic">Noch keine Aufgaben.</li>}
        {game.tasks.map((task) => (
          <li
            key={task.id}
            draggable={isSetup}
            onDragStart={(e) => {
              if (!isSetup) return;
              e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'task', taskId: task.id }));
            }}
            className={`flex justify-between items-center px-3 py-2 rounded bg-slate-900/50 border border-[var(--border)] ${
              isSetup ? 'cursor-grab active:cursor-grabbing' : ''
            }`}
          >
            <span className="text-[var(--text-h)]">
              {task.text}
              {task.isPrivate && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs text-slate-400">
                  <span>🔒</span>
                  <UserInline users={users} userIds={task.assignedTo} />
                </span>
              )}
            </span>
            {isSetup && (
              <button onClick={() => remove(task.id)} className="text-[var(--danger)] hover:text-red-300 text-sm">
                Entfernen
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
