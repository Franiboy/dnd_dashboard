type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function formatMessage(level: LogLevel, category: string, message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] [${category}] ${message}`;
}

export function createLogger(category: string) {
  return {
    debug: (message: string, ...args: unknown[]) =>
      console.debug(formatMessage('debug', category, message), ...args),
    info: (message: string, ...args: unknown[]) =>
      console.info(formatMessage('info', category, message), ...args),
    warn: (message: string, ...args: unknown[]) =>
      console.warn(formatMessage('warn', category, message), ...args),
    error: (message: string, ...args: unknown[]) =>
      console.error(formatMessage('error', category, message), ...args),
  };
}

export const logger = createLogger('app');
