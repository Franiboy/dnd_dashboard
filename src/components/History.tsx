import type { BingoGame } from '../../shared/types';

interface HistoryProps {
  game: BingoGame;
}

export function History({ game }: HistoryProps) {
  return (
    <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5">
      <h2 className="text-xl font-semibold text-[var(--text-h)] mb-4">History</h2>
      <ul className="space-y-2 max-h-64 overflow-auto text-sm">
        {game.history.length === 0 && <li className="text-slate-500 italic">Noch keine Ereignisse.</li>}
        {game.history.map((entry) => (
          <li key={entry.id} className="text-slate-300 border-b border-[var(--border)] pb-2 last:border-0">
            <span className="text-slate-500 text-xs">{new Date(entry.timestamp).toLocaleTimeString('de-DE')}</span>
            <span className="text-[var(--text-h)] font-medium ml-2">{entry.playerName}</span>: {entry.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
