import type { BingoGame } from '../../shared/types';

interface PlayerListProps {
  game: BingoGame;
  playerId: string | null;
}

export function PlayerList({ game, playerId }: PlayerListProps) {
  const onlinePlayers = game.players.filter((p) => p.online);
  return (
    <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5">
      <h2 className="text-xl font-semibold text-[var(--text-h)] mb-4">Spieler</h2>
      <ul className="space-y-2">
        {onlinePlayers.length === 0 && <li className="text-slate-500 italic">Noch keine Spieler.</li>}
        {onlinePlayers.map((p) => (
          <li
            key={p.id}
            className={`flex items-center justify-between px-3 py-2 rounded border ${
              p.id === playerId ? 'border-[var(--accent)]' : 'border-[var(--border)]'
            }`}
          >
            <span className="text-[var(--text-h)] font-medium">
              {p.name} {p.id === playerId && '(Du)'}
            </span>
            <span className="flex items-center gap-2">
              {p.locked && (
                <span
                  className="text-lg leading-none"
                  title="Bereit – Board eingelockt"
                  aria-label="Bereit"
                >
                  🔒
                </span>
              )}
              <span
                className={`text-xs px-2 py-1 rounded ${
                  p.status === 'bingo'
                    ? 'bg-[var(--accent)] text-slate-900'
                    : p.status === 'playing'
                    ? 'bg-[var(--warning)] text-slate-900'
                    : 'bg-slate-700 text-slate-300'
                }`}
              >
                {p.status === 'lobby' && 'Lobby'}
                {p.status === 'playing' && 'Spielt'}
                {p.status === 'bingo' && 'BINGO!'}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
