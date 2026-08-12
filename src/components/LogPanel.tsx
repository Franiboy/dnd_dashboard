import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApi } from '../hooks/useApi';
import type { LogEntry, LogLevel } from '../../shared/types';

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: 'text-slate-500',
  info: 'text-blue-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
};

const LEVEL_LABELS: Record<LogLevel | 'all', string> = {
  all: 'Alle',
  debug: 'Debug',
  info: 'Info',
  warn: 'Warn',
  error: 'Error',
};

const PAGE_SIZE = 100;
const NEAR_BOTTOM_THRESHOLD = 50;
const TOP_OBSERVER_MARGIN = '100px';
const COLLAPSE_THRESHOLD_CHARS = 120;

interface ExpandableLogContentProps {
  value: unknown;
  label?: string;
}

function formatJsonPreview(value: unknown, maxChars = 80): string {
  try {
    const compact = JSON.stringify(value, null, 0);
    if (compact.length <= maxChars) return compact;
    return `${compact.slice(0, maxChars)}...`;
  } catch {
    return String(value).slice(0, maxChars);
  }
}

interface ExpandableLogContentState {
  isJson: boolean;
  isExpandable: boolean;
  preview: string;
  fullContent: string;
}

function computeExpandableState(value: unknown): ExpandableLogContentState {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        const formatted = JSON.stringify(parsed, null, 2);
        return {
          isJson: true,
          isExpandable: formatted.length > COLLAPSE_THRESHOLD_CHARS,
          preview: formatJsonPreview(parsed),
          fullContent: formatted,
        };
      } catch {
        // not valid JSON, fall through to plain text
      }
    }
    return {
      isJson: false,
      isExpandable: trimmed.length > COLLAPSE_THRESHOLD_CHARS,
      preview: trimmed.slice(0, 80),
      fullContent: trimmed,
    };
  }

  if (typeof value === 'object' && value !== null) {
    try {
      const formatted = JSON.stringify(value, null, 2);
      return {
        isJson: true,
        isExpandable: formatted.length > COLLAPSE_THRESHOLD_CHARS,
        preview: formatJsonPreview(value),
        fullContent: formatted,
      };
    } catch {
      return {
        isJson: false,
        isExpandable: String(value).length > COLLAPSE_THRESHOLD_CHARS,
        preview: String(value).slice(0, 80),
        fullContent: String(value),
      };
    }
  }

  const text = String(value);
  return {
    isJson: false,
    isExpandable: text.length > COLLAPSE_THRESHOLD_CHARS,
    preview: text.slice(0, 80),
    fullContent: text,
  };
}

function ExpandableLogContent({ value, label = 'details' }: ExpandableLogContentProps) {
  const [expanded, setExpanded] = useState(false);
  const { isJson, isExpandable, preview, fullContent } = computeExpandableState(value);

  if (!isExpandable) {
    return <span className="text-slate-300">{isJson ? preview : fullContent}</span>;
  }

  return (
    <span className="inline align-middle">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="inline text-left text-slate-400 hover:text-slate-200 underline decoration-dotted underline-offset-2 align-middle"
      >
        {expanded ? '▼' : '▶'}{" "}
        <span className="text-slate-300 font-mono">{isJson ? preview : label}</span>
      </button>
      {expanded && (
        <pre className="mt-1 p-2 rounded bg-slate-900 border border-slate-700 text-slate-200 break-all whitespace-pre-wrap font-mono text-xs">
          {fullContent}
        </pre>
      )}
    </span>
  );
}

export function LogPanel() {
  const { request } = useApi();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [level, setLevel] = useState<LogLevel | 'all'>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [oldestId, setOldestId] = useState<number | undefined>();
  const containerRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const scrollAdjustRef = useRef<{ oldHeight: number; oldScrollTop: number } | null>(null);
  const levelRef = useRef(level);
  const logsRef = useRef<LogEntry[]>(logs);
  const logsLengthRef = useRef(logs.length);

  useEffect(() => {
    levelRef.current = level;
  }, [level]);

  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  const fetchLogs = useCallback(
    async (before?: number, isInitial = false) => {
      const query = new URLSearchParams();
      if (level !== 'all') query.set('level', level);
      query.set('limit', String(PAGE_SIZE));
      if (before !== undefined) query.set('before', String(before));

      if (isInitial) setIsInitialLoading(true);
      else setIsLoadingOlder(true);

      const { data, error } = await request<{ logs: LogEntry[]; hasMore: boolean }>(
        `/api/admin/logs?${query.toString()}`,
      );

      // Ignore responses that arrive after the user has switched the level filter.
      if (level !== levelRef.current) return;

      if (isInitial) setIsInitialLoading(false);
      else setIsLoadingOlder(false);

      if (error || !data) {
        setHasMore(false);
        return;
      }

      if (!before) {
        setLogs(data.logs);
        setOldestId(data.logs[0]?.id);
        setHasMore(data.hasMore);
        return;
      }

      const older = data.logs;
      if (older.length === 0) {
        setHasMore(false);
        return;
      }

      if (containerRef.current) {
        scrollAdjustRef.current = {
          oldHeight: containerRef.current.scrollHeight,
          oldScrollTop: containerRef.current.scrollTop,
        };
      }

      setLogs((prev) => [...older, ...prev]);
      setOldestId(older[0]?.id);
      setHasMore(data.hasMore);
    },
    [level, request],
  );

  useEffect(() => {
    setLogs([]);
    setHasMore(true);
    setOldestId(undefined);
    setAutoScroll(true);
    fetchLogs(undefined, true);
  }, [fetchLogs]);

  const loadOlder = useCallback(() => {
    if (isLoadingOlder || !hasMore || oldestId === undefined) return;
    fetchLogs(oldestId, false);
  }, [isLoadingOlder, hasMore, oldestId, fetchLogs]);

  useEffect(() => {
    const container = containerRef.current;
    const sentinel = topSentinelRef.current;
    if (!container || !sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingOlder && !isInitialLoading) {
          loadOlder();
        }
      },
      { root: container, rootMargin: `${TOP_OBSERVER_MARGIN} 0px 0px 0px`, threshold: 0 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoadingOlder, isInitialLoading, loadOlder]);

  useEffect(() => {
    if (isInitialLoading) return;

    const source = new EventSource('/api/admin/logs/events', { withCredentials: true });

    source.addEventListener('logs', (event) => {
      try {
        const data = JSON.parse(event.data) as LogEntry[];
        const level = levelRef.current;
        const filtered = level === 'all' ? data : data.filter((log) => log.level === level);
        const byId = new Map<number | string, LogEntry>();
        for (const log of logsRef.current) {
          if (log.id !== undefined) byId.set(log.id, log);
        }
        for (const log of filtered) {
          if (log.id !== undefined) byId.set(log.id, log);
        }
        const merged = Array.from(byId.values()).sort((a, b) => (a.id as number) - (b.id as number));
        const currentOldestId = logsRef.current[0]?.id;
        const mergedOldestId = merged[0]?.id;
        if (
          containerRef.current &&
          mergedOldestId !== undefined &&
          (currentOldestId === undefined || mergedOldestId < currentOldestId)
        ) {
          scrollAdjustRef.current = {
            oldHeight: containerRef.current.scrollHeight,
            oldScrollTop: containerRef.current.scrollTop,
          };
        }
        const newOldestId = mergedOldestId ?? data[0]?.id;
        setLogs(merged);
        setOldestId(newOldestId);
        setHasMore(data.length >= 250 && newOldestId !== undefined);
      } catch {
        // ignore parse errors
      }
    });

    source.addEventListener('log', (event) => {
      try {
        const entry = JSON.parse(event.data) as LogEntry;
        if (levelRef.current !== 'all' && entry.level !== levelRef.current) return;
        setLogs((prev) => {
          const lastId = prev.length > 0 ? prev[prev.length - 1].id : undefined;
          if (entry.id !== undefined && lastId !== undefined && entry.id <= lastId) return prev;
          return [...prev, entry];
        });
      } catch {
        // ignore parse errors
      }
    });

    return () => source.close();
  }, [isInitialLoading]);

  useLayoutEffect(() => {
    if (!scrollAdjustRef.current || !containerRef.current) return;
    const { oldHeight, oldScrollTop } = scrollAdjustRef.current;
    const newHeight = containerRef.current.scrollHeight;
    containerRef.current.scrollTop = newHeight - oldHeight + oldScrollTop;
    scrollAdjustRef.current = null;
  }, [logs]);

  useEffect(() => {
    if (autoScroll && containerRef.current && logs.length > logsLengthRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
    logsLengthRef.current = logs.length;
  }, [logs, autoScroll]);

  useEffect(() => {
    if (autoScroll && containerRef.current && logs.length > 0) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [autoScroll, logs.length]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD;
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
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded border-slate-600 bg-slate-800 text-[var(--accent)]"
            />
            Auto-Scroll
          </label>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as LogLevel | 'all')}
            className="relative z-10 pointer-events-auto bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-[var(--text-h)]"
          >
            {(Object.keys(LEVEL_LABELS) as (LogLevel | 'all')[]).map((l) => (
              <option key={l} value={l}>
                {LEVEL_LABELS[l]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-80 overflow-y-auto rounded-xl bg-slate-950 border border-slate-800 p-4 font-mono text-xs leading-relaxed"
      >
        <div ref={topSentinelRef} className="h-1 w-full" />
        {isLoadingOlder && (
          <p className="text-slate-500 italic text-center py-2">Ältere Logs werden geladen...</p>
        )}
        {!isInitialLoading && logs.length === 0 && (
          <p className="text-slate-600 italic">Keine Logs vorhanden.</p>
        )}
        {logs.map((log, i) => (
          <div key={log.id ?? `log-${i}`} className="break-words mb-1">
            <span className="text-slate-600">{formatTime(log.timestamp)}</span>{' '}
            <span className={`font-semibold ${LEVEL_COLORS[log.level]}`}>
              [{log.level.toUpperCase()}]
            </span>{' '}
            <span className="text-slate-500">[{log.category}]</span>{' '}
            <ExpandableLogContent value={log.message} />
            {log.args.length > 0 && (
              <span className="block ml-4">
                {log.args.map((arg, idx) => (
                  <span key={idx} className="block">
                    <ExpandableLogContent value={arg} label="arg" />
                  </span>
                ))}
              </span>
            )}
          </div>
        ))}
        {isInitialLoading && (
          <p className="text-slate-500 italic text-center py-2">Logs werden geladen...</p>
        )}
      </div>
    </div>
  );
}
