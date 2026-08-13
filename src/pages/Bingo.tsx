import { useEffect } from 'react';
import { Loading } from '../components/Loading';
import { BingoDashboard } from '../components/BingoDashboard';
import type { SafeUser } from '../../shared/types';
import { useSocket } from '../hooks/useSocket';

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
  user: SafeUser | null;
}

export function Bingo({ user }: BingoProps) {
  const { game, socket, playerId, bingo } = useSocket(user);

  useEffect(() => {
    if (bingo) playBingoSound();
  }, [bingo]);

  if (!game) {
    return (
      <div className="min-h-full flex items-center justify-center p-6">
        <Loading size="lg" />
      </div>
    );
  }

  const isSetup = game.status === 'setup';
  const isPlaying = game.status === 'playing';
  const player = game.players.find((p) => p.id === playerId);
  const needsJoin = !player;
  const isAdmin = user?.isAdmin || false;

  // The Bingo banner persists as long as someone has Bingo; the round stays active
  // until the admin ends it (resetGame).
  const bingoPlayers = game.players.filter((p) => p.status === 'bingo');
  const hasBingo = bingoPlayers.length > 0;
  const bingoLabel =
    bingoPlayers.length === 1
      ? `${bingoPlayers[0].name} hat BINGO!`
      : `${bingoPlayers.map((p) => p.name).join(' & ')} haben BINGO!`;

  return (
    <div className="h-full flex flex-col p-4 sm:p-6">
      {hasBingo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-[var(--accent)] text-slate-900 text-4xl sm:text-5xl font-black px-10 py-6 rounded-2xl shadow-2xl animate-bounce text-center max-w-full">
            {bingoLabel}
          </div>
        </div>
      )}

      {needsJoin ? (
        <div className="flex items-center justify-center flex-1 min-h-0">
          <Loading text="Trete dem Spiel bei..." />
        </div>
      ) : (
        <BingoDashboard
          game={game}
          socket={socket}
          playerId={playerId}
          player={player}
          user={user!}
          isAdmin={isAdmin}
          isSetup={isSetup}
          isPlaying={isPlaying}
        />
      )}
    </div>
  );
}
