import { useEffect, useState } from 'react';
import type { BingoGame, SafeUser, Task } from '../../shared/types';
import type { Socket } from '../types';
import { useApi } from '../hooks/useApi';
import { Loading } from './Loading';
import { Modal } from './Modal';
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
  const [usersLoading, setUsersLoading] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editingIsPrivate, setEditingIsPrivate] = useState(false);
  const [editingAssignedTo, setEditingAssignedTo] = useState<string[]>([]);
  const isAdmin = !!currentUser?.isAdmin;
  const ownerId = currentUser?.id;
  const assignableUsers = users.filter((u) => !u.isInitialAdmin);

  useEffect(() => {
    if (!isAdmin) return;
    setUsersLoading(true);
    request<SafeUser[]>('/api/admin/users').then(({ data }) => {
      setUsers(data ?? []);
      setUsersLoading(false);
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

  const startEdit = (task: Task) => {
    setEditingTask(task);
    setEditingText(task.text);
    setEditingIsPrivate(!!task.isPrivate);
    setEditingAssignedTo(task.assignedTo ?? []);
  };

  const cancelEdit = () => {
    setEditingTask(null);
    setEditingText('');
    setEditingIsPrivate(false);
    setEditingAssignedTo([]);
  };

  const saveEdit = () => {
    if (!editingTask || !socket) return;
    socket.emit('updateTask', {
      taskId: editingTask.id,
      text: editingText.trim(),
      isPrivate: editingIsPrivate,
      assignedTo: editingIsPrivate ? editingAssignedTo : [],
    });
    setEditingTask(null);
    setEditingText('');
    setEditingIsPrivate(false);
    setEditingAssignedTo([]);
  };

  return (
    <div className={`h-full flex flex-col ${className || ''}`}>
      {isSetup && (
        <div className="flex flex-col gap-3 mb-2">
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
                  setAssignedTo(checked && ownerId && !currentUser?.isInitialAdmin ? [ownerId] : []);
                }}
                label="Private Aufgabe"
              />
              {isPrivate && ownerId && (
                usersLoading ? (
                  <Loading text="Benutzer laden..." size="sm" />
                ) : (
                  <UserCheckboxList
                    users={assignableUsers}
                    selected={assignedTo}
                    onChange={setAssignedTo}
                    disabledIds={!currentUser?.isInitialAdmin && ownerId ? [ownerId] : []}
                    title="Zugewiesen an (mehrere möglich):"
                    emptyMessage="Keine Benutzer verfügbar."
                  />
                )
              )}
            </div>
          )}
        </div>
      )}
      <ul className={`flex-1 min-h-0 space-y-2 overflow-auto ${listClassName || ''}`}>
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
            {isSetup && isAdmin && (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => startEdit(task)}
                  className="text-slate-400 hover:text-[var(--text-h)] text-sm"
                >
                  Bearbeiten
                </button>
                <button onClick={() => remove(task.id)} className="text-[var(--danger)] hover:text-red-300 text-sm">
                  Entfernen
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {editingTask && (
        <Modal
          isOpen
          title="Aufgabe bearbeiten"
          onClose={cancelEdit}
          actions={
            <>
              <button
                onClick={cancelEdit}
                className="px-4 py-2 rounded border border-[var(--border)] text-[var(--text-h)] hover:bg-slate-800 transition"
              >
                Abbrechen
              </button>
              <button
                onClick={saveEdit}
                disabled={!editingText.trim() || (editingIsPrivate && editingAssignedTo.length === 0)}
                className="px-4 py-2 rounded bg-[var(--accent)] text-slate-900 font-semibold hover:bg-green-400 transition disabled:opacity-50"
              >
                Speichern
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <input
              value={editingText}
              onChange={(e) => setEditingText(e.target.value)}
              placeholder="Aufgabentext..."
              className="w-full px-3 py-2 rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
            <Toggle
              checked={editingIsPrivate}
              onChange={(checked) => {
                setEditingIsPrivate(checked);
                if (!checked) setEditingAssignedTo([]);
              }}
              label="Private Aufgabe"
            />
            {editingIsPrivate && (
              usersLoading ? (
                <Loading text="Benutzer laden..." size="sm" />
              ) : (
                <UserCheckboxList
                  users={assignableUsers}
                  selected={editingAssignedTo}
                  onChange={setEditingAssignedTo}
                  disabledIds={[]}
                  title="Zugewiesen an (mehrere möglich):"
                  emptyMessage="Keine Benutzer verfügbar."
                />
              )
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
