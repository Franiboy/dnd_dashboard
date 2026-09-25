import type { BingoGame } from '../../shared/types';
import { useI18n } from '../hooks/useI18n';
import { Avatar } from './Avatar';
import { TallyMarks } from './TallyMarks';

interface PlayerListProps {
  game: BingoGame;
  playerId: string | null;
  className?: string;
}

export function PlayerList({ game, playerId, className }: PlayerListProps) {
  const { t, formatNumber } = useI18n();
  // All participants are shown - players and dungeon masters permanently,
  // even before they check in. Guests are spectators and stay hidden; legacy
  // entries without a stored role predate the role system and remain visible.
  const sortedPlayers = [...game.players]
    .filter((p) => p.role !== 'guest')
    .sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.joinedAt.localeCompare(b.joinedAt);
    });

  return (
    <div className={`h-full flex flex-col ${className || ''}`}>
      <ul className="flex-1 min-h-0 overflow-auto space-y-3">
        {sortedPlayers.length === 0 && (
          <li className="text-slate-500 italic">{t('bingo.players.empty')}</li>
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
                  title={p.online ? t('bingo.players.online') : t('bingo.players.notInBingo')}
                  aria-label={p.online ? t('bingo.players.online') : t('bingo.players.offline')}
                />
              </span>
              <span className="truncate">
                {p.name} {p.id === playerId && t('bingo.players.you')}
              </span>
              {p.role === 'dungeon_master' && (
                <span
                  className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-900/60 text-purple-200"
                  title={t('bingo.players.dungeonMaster')}
                  aria-label={t('bingo.players.dungeonMaster')}
                >
                  DM
                </span>
              )}
            </span>
            <span className="flex items-center gap-3 shrink-0">
              {p.locked && (
                <span
                  className="text-lg leading-none"
                  title={t('bingo.players.readyTitle')}
                  aria-label={t('bingo.players.ready')}
                >
                  🔒
                </span>
              )}
              <span
                className="flex items-center text-slate-400"
                title={t('bingo.players.wins', {
                  count: p.wins ?? 0,
                  wins: formatNumber(p.wins ?? 0),
                })}
              >
                {(p.wins ?? 0) === 0 ? (
                  <span className="text-xs text-slate-500">{formatNumber(0)}</span>
                ) : (
                  <TallyMarks value={p.wins ?? 0} />
                )}
              </span>
              <span
                className={`text-xs px-2 py-1 rounded ${
                  p.status === 'bingo'
                    ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
                    : p.status === 'playing'
                      ? 'bg-[var(--warning)] text-slate-900'
                      : 'bg-slate-700 text-slate-300'
                }`}
              >
                {!p.online && t('bingo.players.offline')}
                {p.online && p.status === 'lobby' && t('bingo.players.lobby')}
                {p.online && p.status === 'playing' && t('bingo.players.playing')}
                {p.online && p.status === 'bingo' && t('bingo.players.bingo')}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
