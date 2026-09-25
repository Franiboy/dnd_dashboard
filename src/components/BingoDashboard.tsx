import { useState } from 'react';
import type { BingoGame, Player, SafeUser, TaskAudience } from '../../shared/types';
import type { Socket } from '../types';
import { useI18n } from '../hooks/useI18n';
import { BingoGrid } from './BingoGrid';
import { ConfirmDialog } from './ConfirmDialog';
import { SideDrawer, SideDrawerItem } from './SideDrawer';
import { Panel } from './Panel';
import { TabButton } from './TabButton';
import { PlayerList } from './PlayerList';
import { TaskPool } from './TaskPool';
import { TaskStatus } from './TaskStatus';

interface BingoDashboardProps {
  game: BingoGame;
  socket: Socket | null;
  playerId: string | null;
  player: Player | undefined;
  user: SafeUser;
  isAdmin: boolean;
  isSetup: boolean;
  isPlaying: boolean;
}

type MobileTab = 'field' | 'tasks';

// Each participant fills their board exclusively from their own pool:
// dungeon masters from the dm pool, everyone else from the player pool.
function poolFor(role: SafeUser['role'] | Player['role']): TaskAudience {
  return role === 'dungeon_master' ? 'dm' : 'players';
}

function getAvailableTaskCount(game: BingoGame, player: Player): number {
  const audience = poolFor(player.role);
  return game.tasks.filter(
    (t) =>
      (t.audience ?? 'players') === audience &&
      (!t.isPrivate || (player.userId && t.assignedTo?.includes(player.userId)))
  ).length;
}

function SetupControls({ game, socket }: { game: BingoGame; socket: Socket | null }) {
  const { t, formatNumber } = useI18n();
  const needed = game.gridSize * game.gridSize;
  const totalEnough = game.tasks.length >= needed;
  // Soft warning only: the game can be started at any time; players who cannot
  // fill their board (e.g. due to private tasks or an empty dm pool) simply
  // join later.
  const bottleneck = [...game.players]
    .map((p) => ({
      name: p.name,
      count: getAvailableTaskCount(game, p),
    }))
    .sort((a, b) => a.count - b.count)[0];
  const warning =
    bottleneck && bottleneck.count < needed
      ? t('bingo.setup.limitedTasks', {
          count: bottleneck.count,
          name: bottleneck.name,
          availableCount: formatNumber(bottleneck.count),
          requiredCount: formatNumber(needed),
        })
      : null;

  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <label className="text-slate-400 text-xs hidden xl:inline" htmlFor="bingo-grid-size">
        {t('bingo.setup.gridSize')}
      </label>
      <select
        id="bingo-grid-size"
        aria-label={t('bingo.setup.gridSize')}
        value={game.gridSize}
        onChange={(e) => socket?.emit('setGridSize', parseInt(e.target.value))}
        className="px-2 py-1.5 rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] text-xs"
      >
        <option value={3}>
          {formatNumber(3)}x{formatNumber(3)}
        </option>
        <option value={4}>
          {formatNumber(4)}x{formatNumber(4)}
        </option>
        <option value={5}>
          {formatNumber(5)}x{formatNumber(5)}
        </option>
      </select>
      <button
        onClick={() => socket?.emit('startGame')}
        disabled={!totalEnough}
        title={
          !totalEnough
            ? t('bingo.setup.taskRequirement', {
                count: game.tasks.length,
                taskCount: formatNumber(game.tasks.length),
                neededCount: formatNumber(needed),
              })
            : warning
              ? t('bingo.setup.startWithWarning', { warning })
              : t('bingo.setup.start')
        }
        className="px-3 py-1.5 rounded bg-[var(--accent)] text-[var(--accent-contrast)] font-semibold hover:brightness-110 transition disabled:opacity-50 text-xs"
      >
        {t('bingo.setup.start')}
      </button>
    </div>
  );
}

function BoardControls({
  socket,
  player,
  isAdmin,
  isSetup,
  isPlaying,
}: {
  socket: Socket | null;
  player: Player | undefined;
  isAdmin: boolean;
  isSetup: boolean;
  isPlaying: boolean;
}) {
  const { t } = useI18n();
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Boards can be locked in setup and, for late joiners, during the running
  // game (until locked - unlocking is setup-only to avoid retro-editing).
  const lockButton =
    player && (isSetup || (isPlaying && !player.locked)) ? (
      <button
        onClick={() => socket?.emit(player.locked ? 'unlockBoard' : 'lockBoard')}
        className={`px-4 py-2 rounded font-semibold transition text-sm ${
          player.locked
            ? 'bg-slate-700 text-[var(--text-h)] hover:bg-slate-600'
            : 'bg-[var(--accent)] text-[var(--accent-contrast)] hover:brightness-110'
        }`}
      >
        {player.locked ? t('bingo.board.unlock') : t('bingo.board.lock')}
      </button>
    ) : null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {lockButton}
        {isPlaying && isAdmin && (
          <button
            onClick={() => setShowResetConfirm(true)}
            className="px-4 py-2 rounded bg-[var(--danger)] text-white font-semibold hover:bg-red-400 transition text-sm"
          >
            {t('bingo.board.endAndStartNewRound')}
          </button>
        )}
      </div>

      {showResetConfirm && (
        <ConfirmDialog
          title={t('bingo.board.resetTitle')}
          confirmLabel={t('bingo.board.resetConfirmLabel')}
          variant="danger"
          onConfirm={() => {
            setShowResetConfirm(false);
            socket?.emit('resetGame');
          }}
          onCancel={() => setShowResetConfirm(false)}
        >
          <p>{t('bingo.board.resetDescription')}</p>
        </ConfirmDialog>
      )}
    </>
  );
}

export function BingoDashboard({
  game,
  socket,
  playerId,
  player,
  user,
  isAdmin,
  isSetup,
  isPlaying,
}: BingoDashboardProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<MobileTab>('field');

  // Late joiners fill their board while the game is already running.
  const editingBoard = (isSetup || isPlaying) && !!player && !player.locked;

  const fieldPanelActions =
    isAdmin && isSetup ? <SetupControls game={game} socket={socket} /> : undefined;

  // Tasks the current user may place on their board: exclusively from their
  // own pool (dm pool for dungeon masters, player pool for everyone else).
  const audience = poolFor(user.role);
  const availableTasks = game.tasks.filter(
    (task) =>
      (task.audience ?? 'players') === audience &&
      (!task.isPrivate || (user.id && task.assignedTo?.includes(user.id)))
  );

  const boardControls = (
    <BoardControls
      socket={socket}
      player={player}
      isAdmin={isAdmin}
      isSetup={isSetup}
      isPlaying={isPlaying}
    />
  );

  const fieldPanel = (
    <Panel title={t('bingo.board.title')} className="min-h-0" actions={fieldPanelActions}>
      <BingoGrid
        game={game}
        socket={socket}
        playerId={playerId}
        className="flex-1 min-h-0"
        controls={boardControls}
        availableTasks={availableTasks}
      />
    </Panel>
  );

  const taskPanel =
    isSetup || isPlaying ? (
      <Panel title={t('bingo.tasks.label')} className="flex-1 min-h-0">
        {editingBoard ? (
          <TaskPool
            game={game}
            socket={socket}
            isSetup={isSetup}
            canDrag
            currentUser={user}
            playerId={playerId}
            className="h-full flex flex-col"
            listClassName="flex-1 min-h-0 overflow-auto"
          />
        ) : isPlaying && isAdmin ? (
          <TaskStatus game={game} socket={socket} />
        ) : (
          <p className="text-slate-400">{t('bingo.board.waitingForStart')}</p>
        )}
      </Panel>
    ) : null;

  const tabs: { id: MobileTab; label: string }[] = [
    { id: 'field', label: t('bingo.board.fieldTab') },
    { id: 'tasks', label: t('bingo.tasks.label') },
  ];

  return (
    <div className="h-full flex flex-col min-h-0">
      <SideDrawer side="right" width="18rem" fitContent maxWidth="min(28rem, calc(100vw - 16rem))">
        <SideDrawerItem id="bingo-players" label={t('bingo.players.label')} icon={<span>👤</span>}>
          <PlayerList game={game} playerId={playerId} />
        </SideDrawerItem>

        {isPlaying && (
          <SideDrawerItem id="bingo-tasks" label={t('bingo.tasks.label')} icon={<span>📋</span>}>
            {editingBoard ? (
              <TaskPool
                game={game}
                socket={socket}
                isSetup={false}
                canDrag
                currentUser={user}
                playerId={playerId}
                className="h-full flex flex-col"
                listClassName="flex-1 min-h-0 overflow-auto"
              />
            ) : isAdmin ? (
              <TaskStatus game={game} socket={socket} />
            ) : (
              <p className="text-slate-400">{t('bingo.board.waitForEnd')}</p>
            )}
          </SideDrawerItem>
        )}
      </SideDrawer>

      {/* Desktop layout */}
      {isPlaying && !editingBoard ? (
        <div className="hidden md:block flex-1 min-h-0">{fieldPanel}</div>
      ) : (
        <div className="hidden md:grid md:grid-cols-[1.5fr_1fr] lg:grid-cols-[1.75fr_1fr] gap-4 flex-1 min-h-0">
          {fieldPanel}
          {taskPanel}
        </div>
      )}

      {/* Mobile layout */}
      <div className="md:hidden flex flex-col flex-1 min-h-0 gap-3">
        {isPlaying && !editingBoard ? (
          // During play the field takes the full width; tasks live in the SideDrawer.
          <div className="flex-1 min-h-0">{fieldPanel}</div>
        ) : (
          // Setup: field and tasks via tabs.
          <>
            <div className="flex items-center gap-2 shrink-0">
              {tabs.map((tab) => (
                <TabButton
                  key={tab.id}
                  active={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </TabButton>
              ))}
            </div>

            {activeTab === 'field' && <div className="flex-1 min-h-0">{fieldPanel}</div>}

            {activeTab === 'tasks' &&
              (taskPanel ?? (
                <Panel title={t('bingo.tasks.label')} className="flex-1 min-h-0">
                  <p className="text-slate-400">{t('bingo.board.waitingForStart')}</p>
                </Panel>
              ))}
          </>
        )}
      </div>
    </div>
  );
}
