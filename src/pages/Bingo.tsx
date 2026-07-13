import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { BingoGame } from '../../shared/types';
import type { Socket } from '../types';
import { TaskPool } from '../components/TaskPool';
import { PlayerList } from '../components/PlayerList';
import { History } from '../components/History';
import { BingoGrid } from '../components/BingoGrid';

interface BingoProps {
  game: BingoGame | null;
  socket: Socket | null;
  playerId: string | null;
  bingo: string | null;
}

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

function ConfirmFor({ game, socket, playerId }: { game: BingoGame; socket: Socket | null; playerId: string | null }) {
  const [selectedTask, setSelectedTask] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState('');

  const submit = () => {
    if (!selectedTask || !selectedPlayer || !socket) return;
    socket.emit('confirmTaskFor', { playerId: selectedPlayer, taskId: selectedTask });
  };

  return (
    <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5 mb-8">
      <h2 className="text-xl font-semibold text-[var(--text-h)] mb-4">Für anderen bestätigen</h2>
      <div className="flex flex-wrap gap-3 items-end">
        <select
          value={selectedTask}
          onChange={(e) => setSelectedTask(e.target.value)}
          className="px-3 py-2 rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)]"
        >
          <option value="">Aufgabe wählen</option>
          {game.tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.text}
            </option>
          ))}
        </select>
        <select
          value={selectedPlayer}
          onChange={(e) => setSelectedPlayer(e.target.value)}
          className="px-3 py-2 rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)]"
        >
          <option value="">Spieler wählen</option>
          {game.players
            .filter((p) => p.id !== playerId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
        <button
          onClick={submit}
          className="px-5 py-2 rounded bg-[var(--warning)] text-slate-900 font-semibold hover:bg-amber-300 transition"
        >
          Erledigt
        </button>
      </div>
    </div>
  );
}

export function Bingo({ game, socket, playerId, bingo }: BingoProps) {
  const [name, setName] = useState('');
  const [gridSize, setGridSize] = useState(5);

  useEffect(() => {
    if (bingo) playBingoSound();
  }, [bingo]);

  if (!game) {
    return <div className="p-6 text-center text-slate-400">Lade...</div>;
  }

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !socket) return;
    socket.emit('join', name.trim());
  };

  const start = () => {
    socket?.emit('startGame', gridSize);
  };

  const finish = () => {
    socket?.emit('finishGame');
  };

  const reset = () => {
    if (confirm('Wirklich zurücksetzen? Alle Daten gehen verloren.')) {
      socket?.emit('resetGame');
    }
  };

  const isSetup = game.status === 'setup';
  const isPlaying = game.status === 'playing';
  const player = game.players.find((p) => p.id === playerId);
  const needsJoin = !player;

  return (
    <div className="min-h-screen p-6">
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
        <form onSubmit={join} className="max-w-md mx-auto bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-6">
          <h2 className="text-xl font-semibold text-[var(--text-h)] mb-4">Mitspielen</h2>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dein Name"
            className="w-full px-4 py-3 rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] mb-4 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
          <button
            type="submit"
            className="w-full py-3 rounded bg-[var(--accent)] text-slate-900 font-semibold hover:bg-green-400 transition"
          >
            Beitreten
          </button>
        </form>
      ) : (
        <>
          <div className="grid lg:grid-cols-3 gap-6 mb-8">
            <TaskPool game={game} socket={socket} isSetup={isSetup} />
            <PlayerList game={game} playerId={playerId} />
            <History game={game} />
          </div>

          {isSetup && (
            <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5 mb-8">
              <h2 className="text-xl font-semibold text-[var(--text-h)] mb-4">Spiel starten</h2>
              <div className="flex flex-wrap items-center gap-4">
                <label className="text-slate-400">Feldgröße:</label>
                <select
                  value={gridSize}
                  onChange={(e) => setGridSize(parseInt(e.target.value))}
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
                  {game.tasks.length} Aufgaben, mindestens {gridSize * gridSize} nötig.
                </span>
              </div>
            </div>
          )}

          {isPlaying && (
            <>
              <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5 mb-8">
                <h2 className="text-xl font-semibold text-[var(--text-h)] mb-4">Dein Bingo-Feld</h2>
                <BingoGrid game={game} socket={socket} playerId={playerId} />
                <div className="flex flex-wrap gap-4 mt-6">
                  <button
                    onClick={finish}
                    className="px-6 py-2 rounded bg-[var(--warning)] text-slate-900 font-semibold hover:bg-amber-300 transition"
                  >
                    Spiel beenden
                  </button>
                  <button
                    onClick={reset}
                    className="px-6 py-2 rounded bg-[var(--danger)] text-white font-semibold hover:bg-red-400 transition"
                  >
                    Reset
                  </button>
                </div>
              </div>
              <ConfirmFor game={game} socket={socket} playerId={playerId} />
            </>
          )}

          {game.status === 'finished' && (
            <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5 text-center">
              <h2 className="text-2xl font-bold text-[var(--text-h)] mb-2">Spiel beendet</h2>
              <button
                onClick={reset}
                className="px-6 py-2 rounded bg-[var(--accent)] text-slate-900 font-semibold hover:bg-green-400 transition"
              >
                Neues Spiel
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
