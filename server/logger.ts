import util from 'node:util';
import { db } from './database.js';
import type { LogEntry, LogLevel } from '../shared/types.js';

export type { LogEntry };

const rawRetention = Number(process.env.LOG_RETENTION_MAX);
const MAX_LOGS =
  Number.isFinite(rawRetention) && rawRetention > 0 ? Math.floor(rawRetention) : 100_000;
const MAX_MESSAGE_LENGTH = 5000;
const MAX_EXTRA_ARGS = 5;
const MAX_ARG_LENGTH = 500;
export const MAX_OBJECT_ARG_LENGTH = 50_000;
const MAX_OBJECT_ARG_DEPTH = 3;
const PRUNE_INTERVAL = 100;

interface DbLogRow {
  id: number;
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  args: string;
}

const logBuffer: LogEntry[] = [];
const listeners = new Set<(entry: LogEntry) => void>();
let insertCount = 0;

const originalConsole = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

function ensureLogTable() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        args TEXT NOT NULL DEFAULT '[]'
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_id ON logs (id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_level_id ON logs (level, id);`);
  } catch (err) {
    originalConsole.error('Failed to ensure logs table:', err);
  }
}

ensureLogTable();
pruneLogs();

function rowToLogEntry(row: DbLogRow): LogEntry {
  let args: unknown[] = [];
  try {
    args = JSON.parse(row.args) as unknown[];
  } catch {
    args = [];
  }
  return {
    id: row.id,
    timestamp: row.timestamp,
    level: row.level,
    category: row.category,
    message: row.message,
    args,
  };
}

function formatMessage(entry: LogEntry): string {
  return `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.category}] ${entry.message}`;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function inspectValue(arg: unknown, maxLength: number, depth = 2): string {
  if (typeof arg === 'string') return truncate(arg, maxLength);
  if (arg instanceof Error) return truncate(arg.stack ?? arg.message, maxLength);
  if (arg === undefined) return 'undefined';
  if (arg === null) return 'null';
  try {
    const inspected = util.inspect(arg, {
      depth,
      colors: false,
      maxStringLength: maxLength,
      maxArrayLength: 20,
      breakLength: Infinity,
      compact: true,
    });
    return truncate(inspected, maxLength);
  } catch {
    return truncate(String(arg), maxLength);
  }
}

function serializeFirstArg(arg: unknown): { message: string } {
  return { message: inspectValue(arg, MAX_MESSAGE_LENGTH, 3) };
}

function isPlainObject(arg: unknown): arg is Record<string, unknown> {
  return (
    typeof arg === 'object' &&
    arg !== null &&
    !Array.isArray(arg) &&
    Object.getPrototypeOf(arg) === Object.prototype
  );
}

function safeJsonStringify(arg: unknown, maxLength: number): string {
  try {
    const seen = new Set<unknown>();
    const json = JSON.stringify(arg, (_key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    });
    return truncate(json, maxLength);
  } catch {
    return inspectValue(arg, maxLength, MAX_OBJECT_ARG_DEPTH);
  }
}

function serializeExtraArg(arg: unknown): string {
  if (isPlainObject(arg)) {
    return safeJsonStringify(arg, MAX_OBJECT_ARG_LENGTH);
  }
  return inspectValue(arg, MAX_ARG_LENGTH, 1);
}

function pruneLogs() {
  try {
    const row = db
      .prepare('SELECT id FROM logs ORDER BY id DESC LIMIT 1 OFFSET ?')
      .get(MAX_LOGS) as { id: number } | undefined;
    if (!row) return;
    db.prepare('DELETE FROM logs WHERE id <= ?').run(row.id);
  } catch (err) {
    originalConsole.error('Failed to prune logs:', err);
  }
}

function maybePruneLogs() {
  insertCount += 1;
  if (insertCount % PRUNE_INTERVAL === 0) {
    pruneLogs();
  }
}

function notifyListeners(entry: LogEntry) {
  for (const listener of listeners) {
    try {
      listener(entry);
    } catch {
      // ignore listener errors
    }
  }
}

export function getRecentLogs(count = 250): LogEntry[] {
  try {
    const rows = db
      .prepare(
        'SELECT id, timestamp, level, category, message, args FROM logs ORDER BY id DESC LIMIT ?'
      )
      .all(count) as DbLogRow[];
    return rows.reverse().map(rowToLogEntry);
  } catch (err) {
    originalConsole.error('Failed to read recent logs:', err);
    return logBuffer.slice(-count);
  }
}

export function getLogsPaginated({
  level,
  before,
  limit = 50,
}: {
  level?: LogLevel;
  before?: number;
  limit?: number;
}): { logs: LogEntry[]; hasMore: boolean } {
  const pageSize = Math.min(
    Math.max(Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50, 1),
    500
  );
  let sql = 'SELECT id, timestamp, level, category, message, args FROM logs WHERE id < ?';
  const params: (string | number)[] = [before ?? Number.MAX_SAFE_INTEGER];

  if (level) {
    sql += ' AND level = ?';
    params.push(level);
  }
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(pageSize + 1);

  try {
    const rows = db.prepare(sql).all(...params) as DbLogRow[];
    const hasMore = rows.length > pageSize;
    if (hasMore) rows.pop();
    return { logs: rows.reverse().map(rowToLogEntry), hasMore };
  } catch (err) {
    originalConsole.error('Failed to read paginated logs:', err);
    return { logs: [], hasMore: false };
  }
}

export function subscribeLogs(callback: (entry: LogEntry) => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function pushLog(level: LogLevel, category: string, args: unknown[]): LogEntry {
  const rawArgs = args.length === 0 ? [''] : args;
  const { message } = serializeFirstArg(rawArgs[0]);
  const extraArgs = rawArgs.slice(1, MAX_EXTRA_ARGS + 1).map(serializeExtraArg);
  const timestamp = new Date().toISOString();

  let entry: LogEntry = {
    timestamp,
    level,
    category,
    message,
    args: extraArgs,
  };

  try {
    const result = db
      .prepare(
        'INSERT INTO logs (timestamp, level, category, message, args) VALUES (?, ?, ?, ?, ?)'
      )
      .run(timestamp, level, category, message, JSON.stringify(extraArgs));
    entry = { ...entry, id: result.lastInsertRowid as number };
    maybePruneLogs();
  } catch (err) {
    originalConsole.error('Failed to persist log:', err);
  }

  logBuffer.push(entry);
  if (logBuffer.length > 250) {
    logBuffer.shift();
  }
  notifyListeners(entry);
  return entry;
}

function writeToOriginalConsole(level: LogLevel, entry: LogEntry) {
  const fn = originalConsole[level] ?? originalConsole.log;
  fn(formatMessage(entry), ...entry.args);
}

export function createLogger(category: string) {
  return {
    debug: (...args: unknown[]) => {
      const entry = pushLog('debug', category, args);
      writeToOriginalConsole('debug', entry);
    },
    info: (...args: unknown[]) => {
      const entry = pushLog('info', category, args);
      writeToOriginalConsole('info', entry);
    },
    warn: (...args: unknown[]) => {
      const entry = pushLog('warn', category, args);
      writeToOriginalConsole('warn', entry);
    },
    error: (...args: unknown[]) => {
      const entry = pushLog('error', category, args);
      writeToOriginalConsole('error', entry);
    },
  };
}

function patchConsoleMethod(level: LogLevel) {
  return (...args: unknown[]) => {
    const entry = pushLog(level, 'console', args);
    writeToOriginalConsole(level, entry);
  };
}

console.log = patchConsoleMethod('info');
console.info = patchConsoleMethod('info');
console.debug = patchConsoleMethod('debug');
console.warn = patchConsoleMethod('warn');
console.error = patchConsoleMethod('error');

export const logger = createLogger('app');
