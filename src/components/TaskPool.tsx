import { useState } from 'react';
import type { BingoGame } from '../../shared/types';
import type { Socket } from '../types';

interface TaskPoolProps {
  game: BingoGame;
  socket: Socket | null;
  isSetup: boolean;
  className?: string;
  listClassName?: string;
}

export function TaskPool({ game, socket, isSetup, className, listClassName }: TaskPoolProps) {
  const [text, setText] = useState('');

  const add = () => {
    if (!text.trim() || !socket) return;
    socket.emit('addTask', text.trim());
    setText('');
  };

  const remove = (id: string) => {
    socket?.emit('removeTask', id);
  };

  return (
    <div className={`bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5 ${className || ''}`}>
      <h2 className="text-xl font-semibold text-[var(--text-h)] mb-4">Aufgaben-Pool</h2>
      {isSetup && (
        <div className="flex gap-2 mb-4">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Neue Aufgabe..."
            className="flex-1 px-3 py-2 rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
          <button
            onClick={add}
            className="px-4 py-2 rounded bg-[var(--accent)] text-slate-900 font-semibold hover:bg-green-400 transition"
          >
            Hinzufügen
          </button>
        </div>
      )}
      <ul className={`space-y-2 overflow-auto ${listClassName || 'max-h-64'}`}>
        {game.tasks.length === 0 && <li className="text-slate-500 italic">Noch keine Aufgaben.</li>}
        {game.tasks.map((task) => (
          <li
            key={task.id}
            draggable={isSetup}
            onDragStart={(e) => {
              if (!isSetup) return;
              e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'task', taskId: task.id }));
            }}
            className={`flex justify-between items-center px-3 py-2 rounded bg-slate-900/50 border border-[var(--border)] ${
              isSetup ? 'cursor-grab active:cursor-grabbing' : ''
            }`}
          >
            <span className="text-[var(--text-h)]">{task.text}</span>
            {isSetup && (
              <button
                onClick={() => remove(task.id)}
                className="text-[var(--danger)] hover:text-red-300 text-sm"
              >
                Entfernen
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
