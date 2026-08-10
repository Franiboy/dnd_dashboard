import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BingoGame, SafeUser, Task } from '../../shared/types';
import type { Socket } from '../types';
import { useApi } from '../hooks/useApi';
import { BingoAiSuggestions } from './BingoAiSuggestions';
import { Loading } from './Loading';
import { Modal } from './Modal';
import { Toggle } from './Toggle';
import { Tooltip } from './Tooltip';
import { UserCheckboxList } from './UserCheckboxList';
import { UserInline } from './UserInline';

interface TaskPoolProps {
  game: BingoGame;
  socket: Socket | null;
  isSetup: boolean;
  className?: string;
  listClassName?: string;
  currentUser?: SafeUser | null;
  playerId?: string | null;
}

export function TaskPool({ game, socket, isSetup, className, listClassName, currentUser, playerId }: TaskPoolProps) {
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
  const [showHidden, setShowHidden] = useState(false);
  const [activeTab, setActiveTab] = useState<'tasks' | 'suggestions'>('tasks');
  const ownerId = currentUser?.id;
  const assignableUsers = users.filter((u) => !u.isInitialAdmin);

  const player = game.players.find((p) => p.id === playerId);
  const placedTaskIds = new Set<string>(
    player?.board?.flat().filter((cell) => cell.taskId).map((cell) => cell.taskId!) ?? [],
  );

  const visibleTasks = game.tasks.filter(
    (task) => !task.isPrivate || (ownerId && task.assignedTo?.includes(ownerId)) || showHidden,
  );

  useEffect(() => {
    setUsersLoading(true);
    request<SafeUser[]>('/api/users').then(({ data }) => {
      setUsers(data ?? []);
      setUsersLoading(false);
    });
  }, [request]);

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

  const tabs = (
    <div className="flex items-center gap-2 shrink-0 mb-2">
      <button
        type="button"
        onClick={() => setActiveTab('tasks')}
        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
          activeTab === 'tasks'
            ? 'bg-[var(--accent)] text-slate-900'
            : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-[var(--text-h)]'
        }`}
      >
        Aufgaben
      </button>
      <button
        type="button"
        onClick={() => setActiveTab('suggestions')}
        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
          activeTab === 'suggestions'
            ? 'bg-[var(--accent)] text-slate-900'
            : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-[var(--text-h)]'
        }`}
      >
        Vorschläge
      </button>
    </div>
  );

  const taskList = (
    <>
      {isSetup && (
        <div className="flex flex-col gap-3 mb-2">
          <div className="flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="Neue Aufgabe..."
              className="min-w-0 flex-1 px-3 py-2 rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
            <button
              onClick={add}
              disabled={!text.trim() || (isPrivate && assignedTo.length === 0)}
              className="shrink-0 whitespace-nowrap px-4 py-2 rounded bg-[var(--accent)] text-slate-900 font-semibold hover:bg-green-400 transition disabled:opacity-50"
            >
              Hinzufügen
            </button>
          </div>
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
        </div>
      )}
      <ul className={`flex-1 min-h-0 space-y-2 overflow-auto ${listClassName || ''}`}>
        {visibleTasks.length === 0 && (
          <li className="text-slate-500 italic">
            {game.tasks.length === 0 ? 'Noch keine Aufgaben.' : 'Keine sichtbaren Aufgaben.'}
          </li>
        )}
        {visibleTasks.map((task) => (
          <TaskListItem
            key={task.id}
            task={task}
            users={users}
            isSetup={isSetup}
            placed={placedTaskIds.has(task.id)}
            onEdit={startEdit}
            onRemove={remove}
          />
        ))}
      </ul>

      {currentUser?.isAdmin && (
        <div className="mt-2">
          <Toggle
            checked={showHidden}
            onChange={setShowHidden}
            label="Versteckte Aufgaben anzeigen"
          />
        </div>
      )}
    </>
  );

  return (
    <div className={`h-full flex flex-col ${className || ''}`}>
      {tabs}
      {activeTab === 'tasks' && taskList}
      {activeTab === 'suggestions' && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <BingoAiSuggestions isSetup={isSetup} />
        </div>
      )}

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

function TaskListItem({
  task,
  users,
  isSetup,
  placed,
  onEdit,
  onRemove,
}: {
  task: Task;
  users: SafeUser[];
  isSetup: boolean;
  placed: boolean;
  onEdit: (task: Task) => void;
  onRemove: (id: string) => void;
}) {
  const rowRef = useRef<HTMLLIElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const [twoLine, setTwoLine] = useState(false);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;

    const update = () => {
      const textEl = textRef.current;
      const actionsEl = actionsRef.current;
      if (!textEl || !actionsEl) return;

      // Measure the text's natural (max-content) width beside the actions.
      const prevFlex = textEl.style.flex;
      const prevWidth = textEl.style.width;
      textEl.style.flex = 'none';
      textEl.style.width = 'max-content';
      const textWidth = textEl.scrollWidth;
      textEl.style.flex = prevFlex;
      textEl.style.width = prevWidth;

      const cs = getComputedStyle(row);
      const padding = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) || 0;
      const gap = parseFloat(cs.columnGap) || 12;
      const available = row.clientWidth - padding - gap - actionsEl.offsetWidth;

      setTwoLine(textWidth > available);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(row);
    return () => ro.disconnect();
  }, []);

  const actionButtons = (
    <div
      ref={actionsRef}
      className={`flex shrink-0 items-center gap-3 ${twoLine ? 'self-end pt-1' : ''}`}
    >
      {task.isPrivate && (
        <Tooltip content={<UserInline users={users} userIds={task.assignedTo} />}>
          <span className="text-slate-400">🔒</span>
        </Tooltip>
      )}
      <button onClick={() => onEdit(task)} className="text-slate-400 hover:text-[var(--text-h)] text-sm">
        Bearbeiten
      </button>
      <button onClick={() => onRemove(task.id)} className="text-[var(--danger)] hover:text-red-300 text-sm">
        Entfernen
      </button>
    </div>
  );

  return (
    <li
      ref={rowRef}
      draggable={isSetup}
      onDragStart={(e) => {
        if (!isSetup) return;
        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'task', taskId: task.id }));
      }}
      className={`${twoLine ? 'flex flex-col' : 'flex items-center'} px-3 py-2 rounded border transition ${
        placed ? 'bg-[var(--accent-dim)] border-[var(--accent)]' : 'bg-slate-900/50 border-[var(--border)]'
      } ${isSetup ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <span ref={textRef} className="min-w-0 flex-1 break-words text-[var(--text-h)]">
        {task.text}
      </span>
      {isSetup && actionButtons}
    </li>
  );
}
