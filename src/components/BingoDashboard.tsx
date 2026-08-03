import type { BingoGame, Player, SafeUser } from '../../shared/types';
import type { Socket } from '../types';
import { BingoAiSuggestions } from './BingoAiSuggestions';
import { BingoGrid } from './BingoGrid';
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

function getAvailableTaskCount(game: BingoGame, userId?: string): number {
  return game.tasks.filter((t) => !t.isPrivate || (userId && t.assignedTo?.includes(userId))).length;
}

export function BingoDashboard({ game, socket, playerId, player, user, isAdmin, isSetup, isPlaying }: BingoDashboardProps) {
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

  const start = () => socket?.emit('startGame');
  const reset = () => {
    if (confirm('Neue Runde starten? Aufgaben bleiben erhalten, die Bretter werden zurückgesetzt.')) {
      socket?.emit('resetGame');
    }
  };

  const lockButton = player && isSetup && (
    <button
      onClick={() => socket?.emit(player.locked ? 'unlockBoard' : 'lockBoard')}
      className={`px-6 py-2 rounded font-semibold transition ${
        player.locked
          ? 'bg-slate-700 text-[var(--text-h)] hover:bg-slate-600'
          : 'bg-[var(--accent)] text-slate-900 hover:bg-green-400'
      }`}
    >
      {player.locked ? 'Entsperren' : 'Einlocken'}
    </button>
  );

  const boardControls = (
    <>
      {lockButton}
      {isPlaying && isAdmin && (
        <button
          onClick={reset}
          className="px-6 py-2 rounded bg-[var(--danger)] text-white font-semibold hover:bg-red-400 transition"
        >
          Beenden & neue Runde
        </button>
      )}
    </>
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(420px,1fr)_minmax(420px,1.5fr)] xl:grid-rows-1 gap-4 flex-1 min-h-0">
      <div className="flex flex-col gap-4 min-h-0">
        <Panel title="Spieler" className="flex-1 min-h-0">
          <PlayerList game={game} playerId={playerId} />
        </Panel>
        {isSetup && (
          <Panel title="Spiel starten" className="h-auto">
            {isAdmin ? (
              <div className="flex flex-wrap items-center gap-4">
                <label className="text-slate-400">Feldgröße:</label>
                <select
                  value={game.gridSize}
                  onChange={(e) => socket?.emit('setGridSize', parseInt(e.target.value))}
                  className="px-3 py-2 rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)]"
                >
                  <option value={3}>3x3</option>
                  <option value={4}>4x4</option>
                  <option value={5}>5x5</option>
                </select>
                <button
                  onClick={start}
                  disabled={!canStartByTasks}
                  className="px-6 py-2 rounded bg-[var(--accent)] text-slate-900 font-semibold hover:bg-green-400 transition disabled:opacity-50"
                >
                  Spiel starten
                </button>
                <span className={`text-sm ${canStartByTasks ? 'text-slate-500' : 'text-[var(--danger)]'}`}>
                  {!totalEnough ? (
                    <>
                      {game.tasks.length} Aufgaben, mindestens {needed} nötig.
                    </>
                  ) : playerAvailableCounts.length === 0 ? (
                    <>
                      {game.tasks.length} Aufgaben, mindestens {needed} pro Spieler nötig.
                    </>
                  ) : bottleneck && bottleneck.count < needed ? (
                    <>
                      {bottleneck.name} hat nur {bottleneck.count} von {needed} Aufgaben verfügbar.
                    </>
                  ) : (
                    <>
                      {game.tasks.length} Aufgaben, jeder Spieler hat mindestens {needed} verfügbar.
                    </>
                  )}
                </span>
              </div>
            ) : (
              <p className="text-slate-400">
                Warte auf Spielstart. Vergiss nicht, dein Board einzulocken, sobald du fertig bist.
              </p>
            )}
          </Panel>
        )}
      </div>

      <Panel title="Dein Bingo-Feld" className="min-h-0">
        <BingoGrid
          game={game}
          socket={socket}
          playerId={playerId}
          className="flex-1 min-h-0"
          controls={boardControls}
        />
      </Panel>

      <div className="flex flex-col gap-4 min-h-0">
        {isSetup ? (
          <>
            <Panel title="Aufgaben-Pool" className="min-h-0 flex-[2] h-auto">
              <TaskPool
                game={game}
                socket={socket}
                isSetup={isSetup}
                currentUser={user}
                playerId={playerId}
                className="h-full flex flex-col"
                listClassName="flex-1 min-h-0 overflow-auto"
              />
            </Panel>
            <Panel title="KI-Vorschläge" className="min-h-0 flex-1 h-auto">
              <BingoAiSuggestions isSetup={isSetup} />
            </Panel>
          </>
        ) : isPlaying && isAdmin ? (
          <Panel title="Aufgaben-Status" className="min-h-0">
            <TaskStatus game={game} socket={socket} />
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
