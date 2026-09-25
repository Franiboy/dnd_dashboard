import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BingoGame, SafeUser, Task, TaskAudience } from '../../shared/types';
import type { Socket } from '../types';
import { useApi, type ApiResponse } from '../hooks/useApi';
import { useI18n } from '../hooks/useI18n';
import { localizeServerMessage } from '../i18n/serverMessages';
import type { TFunction, TranslationKey } from '../i18n/messages';
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
  /** Allow dragging tasks onto the board (setup and late joiners during play). */
  canDrag?: boolean;
  className?: string;
  listClassName?: string;
  currentUser?: SafeUser | null;
  playerId?: string | null;
}

type LocalizedApiError = Pick<
  ApiResponse<unknown>,
  'error' | 'errorCode' | 'messageKey' | 'errorParams' | 'params'
>;

function localizeApiError(
  response: LocalizedApiError,
  t: TFunction,
  fallbackKey: TranslationKey
): string | null {
  const { error, errorCode, messageKey, errorParams, params } = response;
  if (!error) return null;
  if (!messageKey && !errorCode) return error;

  return (
    localizeServerMessage(
      {
        message: error,
        errorCode,
        messageKey,
        params: errorParams ?? params,
      },
      t,
      { fallback: error, fallbackKey }
    ) ?? t(fallbackKey)
  );
}

export function TaskPool({
  game,
  socket,
  isSetup,
  canDrag = isSetup,
  className,
  listClassName,
  currentUser,
  playerId,
}: TaskPoolProps) {
  const { request } = useApi();
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [assignedTo, setAssignedTo] = useState<string[]>([]);
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editingIsPrivate, setEditingIsPrivate] = useState(false);
  const [editingAssignedTo, setEditingAssignedTo] = useState<string[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [activeTab, setActiveTab] = useState<'tasks' | 'suggestions'>('tasks');
  // Admins manage both pools and can switch; dungeon masters always see
  // their own pool, everyone else the player pool.
  const [preferredAudience, setPreferredAudience] = useState<TaskAudience>('players');
  const isAdminUser = !!currentUser?.isAdmin;
  const isDmUser = currentUser?.role === 'dungeon_master';
  const activeAudience: TaskAudience = isAdminUser
    ? preferredAudience
    : isDmUser
      ? 'dm'
      : 'players';
  const ownerId = currentUser?.id;
  const assignableUsers = users.filter((u) => !u.isInitialAdmin);

  const player = game.players.find((p) => p.id === playerId);
  const placedTaskIds = new Set<string>(
    player?.board
      ?.flat()
      .filter((cell) => cell.taskId)
      .map((cell) => cell.taskId!) ?? []
  );

  const visibleTasks = game.tasks.filter(
    (task) =>
      (task.audience ?? 'players') === activeAudience &&
      (!task.isPrivate || (ownerId && task.assignedTo?.includes(ownerId)) || showHidden)
  );

  useEffect(() => {
    request<SafeUser[]>('/api/users', undefined, false).then((response) => {
      setUsers(response.data ?? []);
      setUsersError(localizeApiError(response, t, 'bingo.taskPool.usersError'));
      setUsersLoading(false);
    });
  }, [request, t]);

  const add = () => {
    if (!text.trim() || !socket) return;
    const dmPool = activeAudience === 'dm';
    if (!dmPool && isPrivate && (!ownerId || assignedTo.length === 0)) return;
    socket.emit('addTask', {
      text: text.trim(),
      isPrivate: dmPool ? false : isPrivate,
      assignedTo: !dmPool && isPrivate ? assignedTo : [],
      audience: activeAudience,
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
      isPrivate: editingTask.audience === 'dm' ? false : editingIsPrivate,
      assignedTo: editingTask.audience !== 'dm' && editingIsPrivate ? editingAssignedTo : [],
      audience: editingTask.audience,
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
            ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
            : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-[var(--text-h)]'
        }`}
      >
        {t('bingo.tasks.label')}
      </button>
      <button
        type="button"
        onClick={() => setActiveTab('suggestions')}
        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
          activeTab === 'suggestions'
            ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
            : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-[var(--text-h)]'
        }`}
      >
        {t('bingo.taskPool.suggestionsTab')}
      </button>
    </div>
  );

  const poolSwitcher = isAdminUser && isSetup && (
    <div className="flex items-center gap-2 shrink-0 mb-2">
      <span className="text-slate-400 text-xs">{t('bingo.taskPool.pool')}</span>
      {(['players', 'dm'] as TaskAudience[]).map((aud) => (
        <button
          key={aud}
          type="button"
          onClick={() => setPreferredAudience(aud)}
          className={`px-2 py-1 rounded text-xs font-medium transition ${
            activeAudience === aud
              ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-[var(--text-h)]'
          }`}
        >
          {t(aud === 'dm' ? 'bingo.taskPool.dmPool' : 'bingo.taskPool.playerPool')}
        </button>
      ))}
    </div>
  );

  const taskList = (
    <>
      {poolSwitcher}
      {isSetup && (
        <div className="flex flex-col gap-3 mb-2">
          <div className="flex gap-2">
            <input
              value={text}
              aria-label={t(
                activeAudience === 'dm'
                  ? 'bingo.taskPool.newDmTaskPlaceholder'
                  : 'bingo.taskPool.newTaskPlaceholder'
              )}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder={t(
                activeAudience === 'dm'
                  ? 'bingo.taskPool.newDmTaskPlaceholder'
                  : 'bingo.taskPool.newTaskPlaceholder'
              )}
              className="min-w-0 flex-1 px-3 py-2 rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
            <button
              onClick={add}
              disabled={
                !text.trim() || (activeAudience !== 'dm' && isPrivate && assignedTo.length === 0)
              }
              className="shrink-0 whitespace-nowrap px-4 py-2 rounded bg-[var(--accent)] text-[var(--accent-contrast)] font-semibold hover:brightness-110 transition disabled:opacity-50"
            >
              {t('bingo.taskPool.add')}
            </button>
          </div>
          {activeAudience === 'players' && (
            <div className="flex flex-col gap-2 p-3 rounded bg-slate-900/30 border border-[var(--border)]">
              <Toggle
                checked={isPrivate}
                onChange={(checked) => {
                  setIsPrivate(checked);
                  setAssignedTo(
                    checked && ownerId && !currentUser?.isInitialAdmin ? [ownerId] : []
                  );
                }}
                label={t('bingo.taskPool.private')}
              />
              {isPrivate &&
                ownerId &&
                (usersLoading ? (
                  <Loading text={t('bingo.taskPool.loadingUsers')} size="sm" />
                ) : usersError ? (
                  <p className="text-xs text-[var(--danger)]">{usersError}</p>
                ) : (
                  <UserCheckboxList
                    users={assignableUsers}
                    selected={assignedTo}
                    onChange={setAssignedTo}
                    disabledIds={!currentUser?.isInitialAdmin && ownerId ? [ownerId] : []}
                    title={t('bingo.taskPool.assignedTo')}
                    emptyMessage={t('bingo.taskPool.noUsers')}
                  />
                ))}
            </div>
          )}
        </div>
      )}
      <ul className={`flex-1 min-h-0 space-y-2 overflow-auto ${listClassName || ''}`}>
        {visibleTasks.length === 0 && (
          <li className="text-slate-500 italic">
            {t(game.tasks.length === 0 ? 'bingo.tasks.empty' : 'bingo.tasks.noVisible')}
          </li>
        )}
        {visibleTasks.map((task) => (
          <TaskListItem
            key={task.id}
            task={task}
            users={users}
            isSetup={isSetup}
            canDrag={canDrag}
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
            label={t('bingo.taskPool.showHidden')}
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
          <BingoAiSuggestions isSetup={isSetup} audience={activeAudience} />
        </div>
      )}

      {editingTask && (
        <Modal
          isOpen
          title={t('bingo.taskPool.editTitle')}
          onClose={cancelEdit}
          actions={
            <>
              <button
                onClick={cancelEdit}
                className="px-4 py-2 rounded border border-[var(--border)] text-[var(--text-h)] hover:bg-slate-800 transition"
              >
                {t('shared.cancel')}
              </button>
              <button
                onClick={saveEdit}
                disabled={
                  !editingText.trim() || (editingIsPrivate && editingAssignedTo.length === 0)
                }
                className="px-4 py-2 rounded bg-[var(--accent)] text-[var(--accent-contrast)] font-semibold hover:brightness-110 transition disabled:opacity-50"
              >
                {t('bingo.taskPool.save')}
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <input
              value={editingText}
              aria-label={t('bingo.taskPool.taskTextPlaceholder')}
              onChange={(e) => setEditingText(e.target.value)}
              placeholder={t('bingo.taskPool.taskTextPlaceholder')}
              className="w-full px-3 py-2 rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
            <Toggle
              checked={editingIsPrivate}
              onChange={(checked) => {
                setEditingIsPrivate(checked);
                if (!checked) setEditingAssignedTo([]);
              }}
              label={t('bingo.taskPool.private')}
            />
            {editingIsPrivate &&
              editingTask.audience !== 'dm' &&
              (usersLoading ? (
                <Loading text={t('bingo.taskPool.loadingUsers')} size="sm" />
              ) : usersError ? (
                <p className="text-xs text-[var(--danger)]">{usersError}</p>
              ) : (
                <UserCheckboxList
                  users={assignableUsers}
                  selected={editingAssignedTo}
                  onChange={setEditingAssignedTo}
                  disabledIds={[]}
                  title={t('bingo.taskPool.assignedTo')}
                  emptyMessage={t('bingo.taskPool.noUsers')}
                />
              ))}
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
  canDrag = isSetup,
  placed,
  onEdit,
  onRemove,
}: {
  task: Task;
  users: SafeUser[];
  isSetup: boolean;
  canDrag?: boolean;
  placed: boolean;
  onEdit: (task: Task) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useI18n();
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
          <span
            className="text-slate-400"
            title={t('bingo.grid.privateTask')}
            aria-label={t('bingo.grid.privateTask')}
          >
            🔒
          </span>
        </Tooltip>
      )}
      <button
        onClick={() => onEdit(task)}
        className="text-slate-400 hover:text-[var(--text-h)] text-sm"
      >
        {t('bingo.taskPool.editAction')}
      </button>
      <button
        onClick={() => onRemove(task.id)}
        className="text-[var(--danger)] hover:text-red-300 text-sm"
      >
        {t('bingo.tasks.remove')}
      </button>
    </div>
  );

  return (
    <li
      ref={rowRef}
      draggable={canDrag}
      onDragStart={(e) => {
        if (!canDrag) return;
        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'task', taskId: task.id }));
      }}
      className={`${twoLine ? 'flex flex-col' : 'flex items-center'} px-3 py-2 rounded border transition ${
        placed
          ? 'bg-[var(--accent-dim)] border-[var(--accent)]'
          : 'bg-slate-900/50 border-[var(--border)]'
      } ${canDrag ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      {task.audience === 'dm' && (
        <span
          className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-900/60 text-purple-200"
          title={t('bingo.taskPool.dmTask')}
          aria-label={t('bingo.taskPool.dmTask')}
        >
          DM
        </span>
      )}
      <span ref={textRef} className="min-w-0 flex-1 break-words text-[var(--text-h)]">
        {task.text}
      </span>
      {isSetup && actionButtons}
    </li>
  );
}
