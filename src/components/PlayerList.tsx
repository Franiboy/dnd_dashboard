import type { BingoGame } from '../../shared/types';
import { Avatar } from './Avatar';
import { TallyMarks } from './TallyMarks';

interface PlayerListProps {
  game: BingoGame;
  playerId: string | null;
  className?: string;
}

export function PlayerList({ game, playerId, className }: PlayerListProps) {
  // All participants are shown - players and dungeon masters permanently,
  // even before they check in. Online players first, then by join time.
  const sortedPlayers = [...game.players].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.joinedAt.localeCompare(b.joinedAt);
  });

  return (
    <div className={`h-full flex flex-col ${className || ''}`}>
      <ul className="flex-1 min-h-0 overflow-auto space-y-3">
        {sortedPlayers.length === 0 && (
          <li className="text-slate-500 italic">Noch keine Spieler.</li>
        )}
        {sortedPlayers.map((p) => (
          <li
            key={p.id}
            className={`flex items-center justify-between gap-3 px-3 py-2 rounded border transition ${
              p.id === playerId ? 'border-[var(--accent)]' : 'border-[var(--border)]'
            } ${p.online ? '' : 'opacity-50'}`}
          >
            <span className="flex items-center gap-2 text-[var(--text-h)] font-medium min-w-0">
              <span className="relative shrink-0">
                <Avatar src={p.avatarUrl} name={p.name} className="w-7 h-7" />
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-slate-900 ${
                    p.online ? 'bg-green-400' : 'bg-slate-600'
                  }`}
                  title={p.online ? 'Online' : 'Nicht im Bingo'}
                  aria-label={p.online ? 'Online' : 'Offline'}
                />
              </span>
              <span className="truncate">
                {p.name} {p.id === playerId && '(Du)'}
              </span>
              {p.role === 'dungeon_master' && (
                <span
                  className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-900/60 text-purple-200"
                  title="Dungeon Master"
                >
                  DM
                </span>
              )}
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
                {!p.online && 'Offline'}
                {p.online && p.status === 'lobby' && 'Lobby'}
                {p.online && p.status === 'playing' && 'Spielt'}
                {p.online && p.status === 'bingo' && 'BINGO!'}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
