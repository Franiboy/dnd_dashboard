import { useEffect, useState } from 'react';
import type { BingoGame, SafeUser } from '../../shared/types';
import type { Socket } from '../types';
import { useApi, type ApiResponse } from '../hooks/useApi';
import { useI18n } from '../hooks/useI18n';
import { localizeServerMessage } from '../i18n/serverMessages';
import type { TFunction, TranslationKey } from '../i18n/messages';
import { Loading } from './Loading';
import { ConfirmDialog } from './ConfirmDialog';
import { Toggle } from './Toggle';
import { UserInline } from './UserInline';

interface TaskStatusProps {
  game: BingoGame;
  socket: Socket | null;
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

export function TaskStatus({ game, socket }: TaskStatusProps) {
  const { request } = useApi();
  const { t } = useI18n();
  const [pendingTask, setPendingTask] = useState<{
    id: string;
    action: 'confirm' | 'unconfirm';
  } | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const taskMap = new Map(game.tasks.map((t) => [t.id, t]));

  useEffect(() => {
    request<SafeUser[]>('/api/admin/users', undefined, false).then((response) => {
      setUsers(response.data ?? []);
      setUsersError(localizeApiError(response, t, 'bingo.taskPool.usersError'));
      setUsersLoading(false);
    });
  }, [request, t]);

  const taskStatus = game.tasks
    // DM-pool tasks are marked by the dungeon masters themselves.
    .filter((task) => (task.audience ?? 'players') !== 'dm')
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
          <Loading text={t('bingo.taskPool.loadingUsers')} size="sm" />
        </div>
      )}
      {usersError && (
        <p role="alert" className="mb-2 text-sm text-[var(--danger)]">
          {usersError}
        </p>
      )}
      <ul className="flex-1 min-h-0 space-y-2 overflow-auto">
        {taskStatus.length === 0 && (
          <li className="text-slate-500 italic">{t('bingo.tasks.empty')}</li>
        )}
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
                  <span
                    title={t('bingo.grid.privateTask')}
                    aria-label={t('bingo.grid.privateTask')}
                  >
                    🔒
                  </span>
                  <UserInline users={users} userIds={task.assignedTo} />
                </span>
              )}
            </span>
            <span
              className={`text-sm font-semibold ${confirmedBy ? 'text-[var(--accent)]' : 'text-slate-500'}`}
            >
              {confirmedBy ? `✓ ${confirmedBy}` : t('bingo.tasks.open')}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-2">
        <Toggle
          checked={showHidden}
          onChange={setShowHidden}
          label={t('bingo.taskPool.showHidden')}
        />
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
              { scope: t('bingo.tasks.allPlayersScope') }
            )}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
