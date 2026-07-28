import { useEffect, useRef, useState } from 'react';
import type { LogEntry } from '../../shared/types';

const LEVEL_COLORS: Record<LogEntry['level'], string> = {
  debug: 'text-slate-500',
  info: 'text-blue-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
};

const MAX_LOGS = 500;

export function LogPanel() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const source = new EventSource('/api/admin/logs/events', { withCredentials: true });
    source.addEventListener('logs', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (Array.isArray(data)) setLogs(data);
      } catch {
        // ignore parse errors
      }
    });
    source.addEventListener('log', (event) => {
      try {
        const entry = JSON.parse(event.data) as LogEntry;
        setLogs((prev) => [...prev.slice(-MAX_LOGS + 1), entry]);
      } catch {
        // ignore parse errors
      }
    });
    return () => source.close();
  }, []);

  useEffect(() => {
    if (autoScroll && endRef.current) {
      endRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setAutoScroll(isNearBottom);
  };

  const formatTime = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return timestamp;
    }
  };

  return (
    <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-bold text-[var(--text-h)]">Server-Logs</h2>
        <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="rounded border-slate-600 bg-slate-800 text-[var(--accent)]"
          />
          Auto-Scroll
        </label>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-80 overflow-y-auto rounded-xl bg-slate-950 border border-slate-800 p-4 font-mono text-xs leading-relaxed"
      >
        {logs.length === 0 ? (
          <p className="text-slate-600 italic">Noch keine Logs empfangen...</p>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="break-words mb-1">
              <span className="text-slate-600">{formatTime(log.timestamp)}</span>{' '}
              <span className={`font-semibold ${LEVEL_COLORS[log.level]}`}>[{log.level.toUpperCase()}]</span>{' '}
              <span className="text-slate-500">[{log.category}]</span>{' '}
              <span className="text-slate-300">{log.message}</span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
