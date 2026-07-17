import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { Player, SafeUser } from '../../shared/types';
import { useSocket } from '../hooks/useSocket';
import { TaskPool } from '../components/TaskPool';
import { PlayerList } from '../components/PlayerList';
import { BingoGrid } from '../components/BingoGrid';
import { TaskStatus } from '../components/TaskStatus';

function playBingoSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(523.25, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(1046.5, ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.4);
  } catch {
    // ignore
  }
}

interface BingoProps {
  token: string | null;
  user: SafeUser | null;
}

export function Bingo({ token, user }: BingoProps) {
  const { game, socket, playerId, bingo } = useSocket(token, user);

  useEffect(() => {
    if (bingo) playBingoSound();
  }, [bingo]);

  if (!game) {
    return <div className="p-6 text-center text-slate-400">Lade...</div>;
  }

  const start = () => {
    socket?.emit('startGame');
  };

  const reset = () => {
    if (confirm('Neue Runde starten? Aufgaben bleiben erhalten, die Bretter werden zurückgesetzt.')) {
      socket?.emit('resetGame');
    }
  };

  const isSetup = game.status === 'setup';
  const isPlaying = game.status === 'playing';
  const player = game.players.find((p) => p.id === playerId) as Player | undefined;
  const needsJoin = !player;
  const isAdmin = user?.isAdmin || false;

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

  const boardPanel = player && (
    <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5 mb-8">
      <h2 className="text-xl font-semibold text-[var(--text-h)] mb-4">Dein Bingo-Feld</h2>
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1">
          <BingoGrid game={game} socket={socket} playerId={playerId} />
          {isSetup && <div className="flex justify-center mt-4">{lockButton}</div>}
          {isPlaying && isAdmin && (
            <div className="flex flex-wrap gap-4 mt-6">
              <button
                onClick={reset}
                className="px-6 py-2 rounded bg-[var(--danger)] text-white font-semibold hover:bg-red-400 transition"
              >
                Beenden & neue Runde
              </button>
            </div>
          )}
        </div>
        {isSetup && (
          <div className="lg:w-1/3">
            <TaskPool
              game={game}
              socket={socket}
              isSetup={isSetup}
              listClassName="max-h-96"
              currentUser={user}
            />
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-full p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-[var(--text-h)]">Bingo</h1>
        <Link to="/" className="text-slate-400 hover:text-[var(--text-h)]">← Zurück</Link>
      </div>

      {bingo && (
        <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
          <div className="bg-[var(--accent)] text-slate-900 text-5xl font-black px-10 py-6 rounded-2xl shadow-2xl animate-bounce">
            {bingo} hat BINGO!
          </div>
        </div>
      )}

      {needsJoin ? (
        <div className="text-center text-slate-400">Trete dem Spiel bei...</div>
      ) : (
        <>
          <div className="mb-8">
            <PlayerList game={game} playerId={playerId} />
          </div>

          {(isSetup || isPlaying) && boardPanel}

          {isPlaying && isAdmin && <TaskStatus game={game} socket={socket} />}

          {isSetup && (
            <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5 mb-8">
              {isAdmin ? (
                <>
                  <h2 className="text-xl font-semibold text-[var(--text-h)] mb-4">Spiel starten</h2>
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
                      className="px-6 py-2 rounded bg-[var(--accent)] text-slate-900 font-semibold hover:bg-green-400 transition"
                    >
                      Spiel starten
                    </button>
                    <span className="text-slate-500 text-sm">
                      {game.tasks.length} Aufgaben, mindestens {game.gridSize * game.gridSize} nötig.
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="text-xl font-semibold text-[var(--text-h)] mb-2">Warte auf Spielstart</h2>
                  <p className="text-slate-400">Vergiss nicht, dein Board einzulocken, sobald du fertig bist.</p>
                </>
              )}
            </div>
          )}


        </>
      )}
    </div>
  );
}
