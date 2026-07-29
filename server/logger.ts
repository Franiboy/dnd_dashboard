import util from 'node:util';
import type { LogEntry, LogLevel } from '../shared/types.js';

export type { LogEntry };

const MAX_LOGS = 1000;
const MAX_MESSAGE_LENGTH = 5000;
const MAX_EXTRA_ARGS = 5;
const MAX_ARG_LENGTH = 500;
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

function serializeExtraArg(arg: unknown): string {
  return inspectValue(arg, MAX_ARG_LENGTH, 1);
}

function pushLog(level: LogLevel, category: string, args: unknown[]): LogEntry {
  const rawArgs = args.length === 0 ? [''] : args;
  const { message } = serializeFirstArg(rawArgs[0]);
  const extraArgs = rawArgs.slice(1, MAX_EXTRA_ARGS + 1).map(serializeExtraArg);
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    args: extraArgs,
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
