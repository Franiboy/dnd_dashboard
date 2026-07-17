import { useEffect, useMemo, useState } from 'react';
import { GridLayout, useContainerWidth } from 'react-grid-layout';
import type { Layout, LayoutItem } from 'react-grid-layout';
import type { BingoGame, Player, SafeUser } from '../../shared/types';
import type { Socket } from '../types';
import { BingoGrid } from './BingoGrid';
import { GridPanel } from './GridPanel';
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

const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: 'players', x: 0, y: 0, w: 3, h: 4, minW: 2, minH: 2 },
  { i: 'board', x: 3, y: 0, w: 6, h: 8, minW: 3, minH: 4 },
  { i: 'taskPool', x: 9, y: 0, w: 3, h: 8, minW: 2, minH: 3 },
  { i: 'gameControls', x: 0, y: 4, w: 3, h: 3, minW: 2, minH: 2 },
  { i: 'taskStatus', x: 9, y: 8, w: 3, h: 4, minW: 2, minH: 2 },
];

const MARGIN = [16, 16] as const;
const PADDING = [0, 0] as const;

function getDefaultItem(key: string): LayoutItem {
  return DEFAULT_LAYOUT.find((l) => l.i === key) || { i: key, x: 0, y: 0, w: 3, h: 4 };
}

export function BingoDashboard({ game, socket, playerId, player, user, isAdmin, isSetup, isPlaying }: BingoDashboardProps) {
  const storageKey = `bingo-layout-${user.id}`;
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true });

  const visibleKeys = useMemo(() => {
    const keys: string[] = ['players', 'board'];
    if (isSetup) {
      keys.push('taskPool', 'gameControls');
    }
    if (isPlaying && isAdmin) {
      keys.push('taskStatus');
    }
    return keys;
  }, [isSetup, isPlaying, isAdmin]);

  const [layout, setLayout] = useState<Layout>(() => {
    let saved: LayoutItem[] = [];
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) saved = JSON.parse(raw);
    } catch {
      // ignore
    }
    const map = new Map(saved.map((l) => [l.i, l]));
    return visibleKeys.map((key) => map.get(key) || getDefaultItem(key));
  });

  useEffect(() => {
    const map = new Map(layout.map((l) => [l.i, l]));
    const next = visibleKeys.map((key) => map.get(key) || getDefaultItem(key));
    setLayout(next);
  }, [visibleKeys]);

  const handleLayoutChange = (newLayout: Layout) => {
    const visibleSet = new Set(visibleKeys);
    const filtered = newLayout.filter((l) => visibleSet.has(l.i));
    setLayout(filtered);
    try {
      localStorage.setItem(storageKey, JSON.stringify(filtered));
    } catch {
      // ignore
    }
  };

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

  const items = [
    <div key="players">
      <GridPanel title="Spieler">
        <PlayerList game={game} playerId={playerId} />
      </GridPanel>
    </div>,
    <div key="board">
      <GridPanel title="Dein Bingo-Feld">
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <BingoGrid
            game={game}
            socket={socket}
            playerId={playerId}
            className="flex-1 min-h-0"
            controls={boardControls}
          />
        </div>
      </GridPanel>
    </div>,
  ];

  if (isSetup) {
    items.push(
      <div key="taskPool">
        <GridPanel title="Aufgaben-Pool">
          <TaskPool
            game={game}
            socket={socket}
            isSetup={isSetup}
            currentUser={user}
            className="h-full flex flex-col"
            listClassName="flex-1 min-h-0 overflow-auto"
          />
        </GridPanel>
      </div>,
      <div key="gameControls">
        <GridPanel title="Spiel starten">
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
                className="px-6 py-2 rounded bg-[var(--accent)] text-slate-900 font-semibold hover:bg-green-400 transition"
              >
                Spiel starten
              </button>
              <span className="text-slate-500 text-sm">
                {game.tasks.length} Aufgaben, mindestens {game.gridSize * game.gridSize} nötig.
              </span>
            </div>
          ) : (
            <p className="text-slate-400">
              Warte auf Spielstart. Vergiss nicht, dein Board einzulocken, sobald du fertig bist.
            </p>
          )}
        </GridPanel>
      </div>,
    );
  }

  if (isPlaying && isAdmin) {
    items.push(
      <div key="taskStatus">
        <GridPanel title="Aufgaben-Status">
          <TaskStatus game={game} socket={socket} />
        </GridPanel>
      </div>,
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{
        backgroundImage: 'radial-gradient(var(--border) 1px, transparent 1px)',
        backgroundSize: '20px 20px',
      }}
    >
      {mounted && (
        <GridLayout
          className="bingo-grid-layout"
          width={width}
          layout={layout}
          gridConfig={{
            cols: 12,
            rowHeight: 60,
            margin: MARGIN,
            containerPadding: PADDING,
            maxRows: Infinity,
          }}
          dragConfig={{
            handle: '.grid-panel-header',
          }}
          resizeConfig={{
            handles: ['se'],
          }}
          onLayoutChange={handleLayoutChange}
          autoSize
        >
          {items}
        </GridLayout>
      )}
    </div>
  );
}
