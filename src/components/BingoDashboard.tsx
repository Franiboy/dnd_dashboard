import { useState } from 'react';
import type { BingoGame, Player, SafeUser } from '../../shared/types';
import type { Socket } from '../types';
import { BingoGrid } from './BingoGrid';
import { SideDrawer, SideDrawerItem } from './SideDrawer';
import { Panel } from './Panel';
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

function getAvailableTaskCount(game: BingoGame, userId?: string): number {
  return game.tasks.filter((t) => !t.isPrivate || (userId && t.assignedTo?.includes(userId))).length;
}

function SetupControls({
  game,
  socket,
}: {
  game: BingoGame;
  socket: Socket | null;
}) {
  const needed = game.gridSize * game.gridSize;
  const onlinePlayers = game.players.filter((p) => p.online);
  const playerAvailableCounts = onlinePlayers.map((p) => ({
    name: p.name,
    count: getAvailableTaskCount(game, p.userId ?? undefined),
  }));
  const sortedByCount = [...playerAvailableCounts].sort((a, b) => a.count - b.count);
  const bottleneck = sortedByCount[0];
  const totalEnough = game.tasks.length >= needed;
  const everyoneEnough = playerAvailableCounts.length > 0 && playerAvailableCounts.every((p) => p.count >= needed);
  const canStartByTasks = totalEnough && everyoneEnough;

  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <label className="text-slate-400 text-xs hidden xl:inline">Feldgröße:</label>
      <select
        value={game.gridSize}
        onChange={(e) => socket?.emit('setGridSize', parseInt(e.target.value))}
        className="px-2 py-1.5 rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] text-xs"
      >
        <option value={3}>3x3</option>
        <option value={4}>4x4</option>
        <option value={5}>5x5</option>
      </select>
      <button
        onClick={() => socket?.emit('startGame')}
        disabled={!canStartByTasks}
        title={
          !totalEnough
            ? `${game.tasks.length} Aufgaben, mindestens ${needed} nötig`
            : playerAvailableCounts.length === 0
            ? `Mindestens ${needed} pro Spieler nötig`
            : bottleneck && bottleneck.count < needed
            ? `${bottleneck.name} hat nur ${bottleneck.count} von ${needed} Aufgaben`
            : 'Spiel starten'
        }
        className="px-3 py-1.5 rounded bg-[var(--accent)] text-slate-900 font-semibold hover:bg-green-400 transition disabled:opacity-50 text-xs"
      >
        Spiel starten
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
  const reset = () => {
    if (confirm('Neue Runde starten? Aufgaben bleiben erhalten, die Bretter werden zurückgesetzt.')) {
      socket?.emit('resetGame');
    }
  };

  const lockButton = player && isSetup && (
    <button
      onClick={() => socket?.emit(player.locked ? 'unlockBoard' : 'lockBoard')}
      className={`px-4 py-2 rounded font-semibold transition text-sm ${
        player.locked
          ? 'bg-slate-700 text-[var(--text-h)] hover:bg-slate-600'
          : 'bg-[var(--accent)] text-slate-900 hover:bg-green-400'
      }`}
    >
      {player.locked ? 'Entsperren' : 'Einlocken'}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      {lockButton}
      {isPlaying && isAdmin && (
        <button
          onClick={reset}
          className="px-4 py-2 rounded bg-[var(--danger)] text-white font-semibold hover:bg-red-400 transition text-sm"
        >
          Beenden & neue Runde
        </button>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-2 py-2 text-sm font-medium rounded-lg transition ${
        active
          ? 'bg-[var(--accent)] text-slate-900'
          : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-[var(--text-h)]'
      }`}
    >
      {children}
    </button>
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
  const [activeTab, setActiveTab] = useState<MobileTab>('field');

  const fieldPanelActions = isAdmin && isSetup ? <SetupControls game={game} socket={socket} /> : undefined;

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
    <Panel title="Dein Bingo-Feld" className="min-h-0" actions={fieldPanelActions}>
      <BingoGrid
        game={game}
        socket={socket}
        playerId={playerId}
        className="flex-1 min-h-0"
        controls={boardControls}
      />
    </Panel>
  );

  const taskPanel = isSetup || isPlaying ? (
    <Panel title="Aufgaben" className="flex-1 min-h-0">
      {isSetup ? (
        <TaskPool
          game={game}
          socket={socket}
          isSetup={isSetup}
          currentUser={user}
          playerId={playerId}
          className="h-full flex flex-col"
          listClassName="flex-1 min-h-0 overflow-auto"
        />
      ) : isPlaying && isAdmin ? (
        <TaskStatus game={game} socket={socket} />
      ) : (
        <p className="text-slate-400">Warte auf Spielstart...</p>
      )}
    </Panel>
  ) : null;

  const tabs: { id: MobileTab; label: string }[] = [
    { id: 'field', label: 'Feld' },
    { id: 'tasks', label: 'Aufgaben' },
  ];

  return (
    <div className="h-full flex flex-col min-h-0">
      <SideDrawer side="right" width="18rem">
        <SideDrawerItem id="bingo-players" label="Spieler" icon={<span>👤</span>}>
          <PlayerList game={game} playerId={playerId} />
        </SideDrawerItem>
      </SideDrawer>

      {/* Desktop layout */}
      <div className="hidden md:grid md:grid-cols-[1.5fr_1fr] lg:grid-cols-[1.75fr_1fr] gap-4 flex-1 min-h-0">
        {fieldPanel}
        {taskPanel}
      </div>

      {/* Mobile layout */}
      <div className="md:hidden flex flex-col flex-1 min-h-0 gap-3">
        <div className="flex items-center gap-2 shrink-0">
          {tabs.map((tab) => (
            <TabButton key={tab.id} active={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}>
              {tab.label}
            </TabButton>
          ))}
        </div>

        {activeTab === 'field' && fieldPanel}

        {activeTab === 'tasks' && (taskPanel ?? (
          <Panel title="Aufgaben" className="flex-1 min-h-0">
            <p className="text-slate-400">Warte auf Spielstart...</p>
          </Panel>
        ))}
      </div>
    </div>
  );
}
