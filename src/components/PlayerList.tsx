import type { BingoGame } from '../../shared/types';
import { Avatar } from './Avatar';
import { TallyMarks } from './TallyMarks';

interface PlayerListProps {
  game: BingoGame;
  playerId: string | null;
  className?: string;
}

export function PlayerList({ game, playerId, className }: PlayerListProps) {
  const onlinePlayers = game.players.filter((p) => p.online);
  return (
    <div className={`h-full flex flex-col ${className || ''}`}>
      <ul className="flex-1 min-h-0 overflow-auto space-y-3">
        {onlinePlayers.length === 0 && <li className="text-slate-500 italic">Noch keine Spieler.</li>}
        {onlinePlayers.map((p) => (
          <li
            key={p.id}
            className={`flex items-center justify-between gap-3 px-3 py-2 rounded border ${
              p.id === playerId ? 'border-[var(--accent)]' : 'border-[var(--border)]'
            }`}
          >
            <span className="flex items-center gap-2 text-[var(--text-h)] font-medium min-w-0">
              <Avatar src={p.avatarUrl} name={p.name} className="w-7 h-7 shrink-0" />
              <span className="truncate">{p.name} {p.id === playerId && '(Du)'}</span>
            </span>
            <span className="flex items-center gap-3 shrink-0">
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
                className="flex items-center text-slate-400"
                title={`${p.wins ?? 0} ${(p.wins ?? 0) === 1 ? 'Sieg' : 'Siege'}`}
              >
                <TallyMarks value={p.wins ?? 0} />
              </span>
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
