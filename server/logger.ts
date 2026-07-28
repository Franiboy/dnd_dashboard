import util from 'node:util';
import type { LogEntry, LogLevel } from '../shared/types.js';

export type { LogEntry };

const MAX_LOGS = 1000;
const logBuffer: LogEntry[] = [];
const listeners = new Set<(entry: LogEntry) => void>();

const originalConsole = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

export function getRecentLogs(count = 250): LogEntry[] {
  return logBuffer.slice(-count);
}

export function subscribeLogs(callback: (entry: LogEntry) => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
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

function formatMessage(entry: LogEntry): string {
  return `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.category}] ${entry.message}`;
}

function serializeFirstArg(arg: unknown): { message: string } {
  if (typeof arg === 'string') {
    return { message: arg };
  }
  if (arg instanceof Error) {
    return { message: arg.stack ?? arg.message };
  }
  if (arg === undefined) {
    return { message: 'undefined' };
  }
  if (arg === null) {
    return { message: 'null' };
  }
  try {
    return { message: util.inspect(arg, { depth: 3, colors: false }) };
  } catch {
    return { message: String(arg) };
  }
}

function pushLog(level: LogLevel, category: string, args: unknown[]): LogEntry {
  const rawArgs = args.length === 0 ? [''] : args;
  const { message } = serializeFirstArg(rawArgs[0]);
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    args: rawArgs.slice(1),
  };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOGS) {
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
