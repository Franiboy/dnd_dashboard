import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { useI18n } from '../hooks/useI18n';
import type { TranslationKey } from '../i18n';
import type { LogEntry, LogLevel } from '../../shared/types';

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: 'text-slate-500',
  info: 'text-blue-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
};

const LEVEL_LABEL_KEYS: Record<LogLevel | 'all', TranslationKey> = {
  all: 'admin.logs.levels.all',
  debug: 'admin.logs.levels.debug',
  info: 'admin.logs.levels.info',
  warn: 'admin.logs.levels.warn',
  error: 'admin.logs.levels.error',
};

const LOG_CATEGORY_LABEL_KEYS: Record<string, TranslationKey> = {
  app: 'admin.logs.categories.app',
  auth: 'admin.logs.categories.auth',
  'auth-routes': 'admin.logs.categories.auth-routes',
  diaryFiles: 'admin.logs.categories.diaryFiles',
  encryption: 'admin.logs.categories.encryption',
  'discord-bot': 'admin.logs.categories.discord-bot',
  storyArcRoutes: 'admin.logs.categories.storyArcRoutes',
  transcriber: 'admin.logs.categories.transcriber',
  errorHandler: 'admin.logs.categories.errorHandler',
  timelineRoutes: 'admin.logs.categories.timelineRoutes',
  'transcription-scheduler': 'admin.logs.categories.transcription-scheduler',
  diaryRoutes: 'admin.logs.categories.diaryRoutes',
  'discord-recorder': 'admin.logs.categories.discord-recorder',
  'recordings-routes': 'admin.logs.categories.recordings-routes',
  'discord-files': 'admin.logs.categories.discord-files',
  'mcp-tokens': 'admin.logs.categories.mcp-tokens',
  'entity-summary-scheduler': 'admin.logs.categories.entity-summary-scheduler',
  'mcp-server': 'admin.logs.categories.mcp-server',
  'diary-summary-scheduler': 'admin.logs.categories.diary-summary-scheduler',
  'session-ai-scheduler': 'admin.logs.categories.session-ai-scheduler',
  sessionBoundary: 'admin.logs.categories.sessionBoundary',
  'discord-token-refresh': 'admin.logs.categories.discord-token-refresh',
  'discord-oauth': 'admin.logs.categories.discord-oauth',
  'summary-scheduler': 'admin.logs.categories.summary-scheduler',
  'bingo-suggestion-scheduler': 'admin.logs.categories.bingo-suggestion-scheduler',
  'session-to-diary-scheduler': 'admin.logs.categories.session-to-diary-scheduler',
  'timeline-scheduler': 'admin.logs.categories.timeline-scheduler',
  'bingo-suggestions': 'admin.logs.categories.bingo-suggestions',
  rewrite: 'admin.logs.categories.rewrite',
  'model-config': 'admin.logs.categories.model-config',
  'ai-actions': 'admin.logs.categories.ai-actions',
  timeline: 'admin.logs.categories.timeline',
  sessionRewrite: 'admin.logs.categories.sessionRewrite',
  sessionToDiary: 'admin.logs.categories.sessionToDiary',
  sessionSummary: 'admin.logs.categories.sessionSummary',
  opencode: 'admin.logs.categories.opencode',
  sessionGameDay: 'admin.logs.categories.sessionGameDay',
  users: 'admin.logs.categories.users',
  knowledge: 'admin.logs.categories.knowledge',
  migrations: 'admin.logs.categories.migrations',
  'session-cleanup-scheduler': 'admin.logs.categories.session-cleanup-scheduler',
  console: 'admin.logs.categories.console',
};

const PAGE_SIZE = 100;
const NEAR_BOTTOM_THRESHOLD = 50;
const TOP_OBSERVER_MARGIN = '100px';
const COLLAPSE_THRESHOLD_CHARS = 120;

interface ExpandableLogContentProps {
  value: unknown;
  label: string;
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

function ExpandableLogContent({ value, label }: ExpandableLogContentProps) {
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
        {expanded ? '▼' : '▶'}{' '}
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
  const { t, formatDateTime } = useI18n();
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
        `/api/admin/logs?${query.toString()}`
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
    [level, request]
  );

  useEffect(() => {
    // oxlint-disable react/set-state-in-effect -- the list state resets when
    // the filter changes and is then refetched from the server.
    setLogs([]);
    setHasMore(true);
    setOldestId(undefined);
    setAutoScroll(true);
    // oxlint-enable react/set-state-in-effect
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
      { root: container, rootMargin: `${TOP_OBSERVER_MARGIN} 0px 0px 0px`, threshold: 0 }
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
        const merged = Array.from(byId.values()).sort(
          (a, b) => (a.id as number) - (b.id as number)
        );
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
    const formatted = formatDateTime(timestamp, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    return formatted || timestamp;
  };

  const formatCategory = (category: string) => {
    const key = LOG_CATEGORY_LABEL_KEYS[category];
    return key ? t(key) : category;
  };

  return (
    <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-bold text-[var(--text-h)]">{t('admin.logs.title')}</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded border-slate-600 bg-slate-800 text-[var(--accent)]"
            />
            {t('admin.logs.autoScroll')}
          </label>
          <select
            aria-label={t('admin.logs.levelLabel')}
            value={level}
            onChange={(e) => setLevel(e.target.value as LogLevel | 'all')}
            className="relative z-10 pointer-events-auto bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-[var(--text-h)]"
          >
            {(Object.keys(LEVEL_LABEL_KEYS) as (LogLevel | 'all')[]).map((l) => (
              <option key={l} value={l}>
                {t(LEVEL_LABEL_KEYS[l])}
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
          <p className="text-slate-500 italic text-center py-2">{t('admin.logs.loadingOlder')}</p>
        )}
        {!isInitialLoading && logs.length === 0 && (
          <p className="text-slate-600 italic">{t('admin.logs.empty')}</p>
        )}
        {logs.map((log, i) => (
          <div key={log.id ?? `log-${i}`} className="break-words mb-1">
            <span className="text-slate-600">{formatTime(log.timestamp)}</span>{' '}
            <span className={`font-semibold ${LEVEL_COLORS[log.level]}`}>
              [{t(LEVEL_LABEL_KEYS[log.level]).toUpperCase()}]
            </span>{' '}
            <span className="text-slate-500">[{formatCategory(log.category)}]</span>{' '}
            <ExpandableLogContent value={log.message} label={t('admin.logs.details')} />
            {log.args.length > 0 && (
              <span className="block ml-4">
                {log.args.map((arg, idx) => (
                  <span key={idx} className="block">
                    <ExpandableLogContent value={arg} label={t('admin.logs.argument')} />
                  </span>
                ))}
              </span>
            )}
          </div>
        ))}
        {isInitialLoading && (
          <p className="text-slate-500 italic text-center py-2">{t('admin.logs.loading')}</p>
        )}
      </div>
    </div>
  );
}
